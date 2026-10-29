import { Hono } from "hono";
import { sql, type Selectable, type Updateable } from "kysely";
import type { z } from "zod";
import type { AppBindings, AppContext } from "../../types/context";
import type { Database } from "../../types/database";
import { createDb, dbBool, dbNow, toIso } from "../../db";
import { AppError } from "../../lib/errors";
import { requireRole } from "../../middleware/roles";
import { createPasswordUser, deleteUser, revokeSessions, setPassword, wouldRemoveLastAdmin } from "../../lib/users";
import { hasRole, type Role } from "../../../shared/roles";
import {
	USER_SORT_FIELDS,
	createUserSchema,
	updateUserSchema,
	userStatus,
	ACTIVITY_SORT_FIELDS,
	describeBrowser,
	type ActivityEvent,
	type ActivitySortField,
	type AdminUser,
	type AdminUserActivity,
	type AdminUserDetail,
	type AdminUserList,
	type UserSortField,
} from "../../../shared/admin-users";

/**
 * User management, mounted at `/api/admin/users`: superadmins only. The
 * example of a CRUD section — list (search, sort, pages), read, create,
 * update, delete. See docs/ADMIN.md.
 */
export const adminUsers = new Hono<AppBindings>();

adminUsers.use("*", requireRole("superadmin"));

type UserRow = Pick<Selectable<Database["users"]>, "id" | "name" | "email" | "role" | "emailVerified" | "createdAt" | "updatedAt">;

/** Seconds since each user's most recent live session was last used; users with none are absent. */
async function idleSecondsFor(db: ReturnType<typeof createDb>, ids: string[]): Promise<Map<string, number>> {
	const idle = new Map<string, number>();
	if (ids.length === 0) return idle;
	const now = Date.now();
	const sessions = await db.selectFrom("sessions").select(["userId", "updatedAt", "expiresAt"]).where("userId", "in", ids).execute();
	for (const s of sessions) {
		if (new Date(s.expiresAt).getTime() <= now) continue;
		const seconds = Math.max(0, Math.round((now - new Date(s.updatedAt).getTime()) / 1000));
		idle.set(s.userId, Math.min(seconds, idle.get(s.userId) ?? Infinity));
	}
	return idle;
}

/** Each user's most recent successful sign-in; users who never signed in are absent. */
async function lastSignInFor(db: ReturnType<typeof createDb>, ids: string[]): Promise<Map<string, string>> {
	const last = new Map<string, string>();
	if (ids.length === 0) return last;
	const rows = await db
		.selectFrom("login_events")
		.select(["user_id", (eb) => eb.fn.max("created_at").as("at")])
		.where("user_id", "in", ids)
		.where("success", "=", dbBool(true))
		// Rows from before sign-outs were recorded have no kind: they are sign-ins.
		.where((eb) => eb.or([eb("event", "is", null), eb("event", "=", "sign-in")]))
		.groupBy("user_id")
		.execute();
	for (const r of rows) {
		const at = toIso(r.at);
		if (r.user_id && at) last.set(r.user_id, at);
	}
	return last;
}

async function present(c: AppContext, rows: UserRow[]): Promise<AdminUser[]> {
	const db = createDb(c.env);
	const ids = rows.map((u) => u.id);
	const [idle, lastSignIn] = await Promise.all([idleSecondsFor(db, ids), lastSignInFor(db, ids)]);
	return rows.map((u) => {
		const idleSeconds = idle.get(u.id) ?? null;
		const emailVerified = Boolean(u.emailVerified);
		return {
			id: u.id,
			name: u.name,
			email: u.email,
			role: u.role,
			emailVerified,
			status: userStatus(emailVerified, idleSeconds),
			idleSeconds,
			lastSignInAt: lastSignIn.get(u.id) ?? null,
			createdAt: toIso(u.createdAt) ?? "",
			updatedAt: toIso(u.updatedAt) ?? "",
		};
	});
}

async function parseBody<T extends z.ZodType>(c: AppContext, schema: T): Promise<z.infer<T>> {
	const body = await c.req.json().catch(() => undefined);
	const result = schema.safeParse(body);
	if (!result.success) {
		const issue = result.error.issues[0];
		const field = issue?.path.join(".");
		throw new AppError(400, field ? `${field}: ${issue.message}` : "The request is not valid.", {
			code: "invalid_input",
			log: JSON.stringify(result.error.issues),
		});
	}
	return result.data;
}

async function findUser(c: AppContext, id: string) {
	const user = await createDb(c.env).selectFrom("users").selectAll().where("id", "=", id).executeTakeFirst();
	if (!user) throw new AppError(404, "That user no longer exists.", { code: "user_not_found", log: `user ${id} not found` });
	return user;
}

async function assertEmailFree(c: AppContext, email: string, exceptId?: string) {
	let query = createDb(c.env).selectFrom("users").select("id").where("email", "=", email);
	if (exceptId) query = query.where("id", "!=", exceptId);
	if (await query.executeTakeFirst()) {
		throw new AppError(409, "Another user already has that email address.", { code: "email_taken" });
	}
}

const USER_COLUMNS = ["id", "name", "email", "role", "emailVerified", "createdAt", "updatedAt"] as const;
/** Ascending: most present first. Offline has no rank: it shows as "—", and empty values always sort last. */
const STATUS_RANK: Record<Exclude<AdminUser["status"], "offline">, number> = { active: 0, idle: 1, disabled: 2 };

/** `GET /?q=&page=1&pageSize=20&sort=createdAt&dir=desc` */
adminUsers.get("/", async (c) => {
	const db = createDb(c.env);
	const q = c.req.query("q")?.trim().toLowerCase();
	const page = Math.max(1, Number(c.req.query("page")) || 1);
	const pageSize = Math.min(100, Math.max(1, Number(c.req.query("pageSize")) || 20));
	const sortParam = c.req.query("sort") as UserSortField;
	const sort = USER_SORT_FIELDS.includes(sortParam) ? sortParam : "createdAt";
	const dir = c.req.query("dir") === "asc" ? "asc" : "desc";

	let filtered = db.selectFrom("users");
	if (q) {
		filtered = filtered.where((eb) =>
			eb.or([eb(sql`lower(${eb.ref("email")})`, "like", `%${q}%`), eb(sql`lower(${eb.ref("name")})`, "like", `%${q}%`)]),
		);
	}

	// The status and the last sign-in come from sessions and the log, not from a
	// column: sort by them after computing them, for everyone who matches, then cut the page.
	if (sort === "status" || sort === "lastSignInAt" || sort === "idleSeconds") {
		const all = await present(c, await filtered.select(USER_COLUMNS).orderBy("createdAt", "desc").orderBy("id").execute());
		const sign = dir === "asc" ? 1 : -1;
		// Empty values (shown as "—") come last in either direction.
		const key = (u: AdminUser): number | null =>
			sort === "status"
				? u.status === "offline"
					? null
					: STATUS_RANK[u.status]
				: sort === "idleSeconds"
					? u.idleSeconds
					: u.lastSignInAt
						? Date.parse(u.lastSignInAt)
						: null;
		all.sort((a, b) => {
			const ka = key(a);
			const kb = key(b);
			if (ka === null || kb === null) return ka === kb ? 0 : ka === null ? 1 : -1;
			return sign * (ka - kb);
		});
		return c.json<AdminUserList>({ users: all.slice((page - 1) * pageSize, page * pageSize), total: all.length, page, pageSize });
	}

	const [rows, count] = await Promise.all([
		filtered
			.select(USER_COLUMNS)
			.orderBy(sort, dir)
			.orderBy("id")
			.limit(pageSize)
			.offset((page - 1) * pageSize)
			.execute(),
		filtered.select((eb) => eb.fn.countAll<number>().as("total")).executeTakeFirst(),
	]);

	return c.json<AdminUserList>({ users: await present(c, rows), total: Number(count?.total ?? 0), page, pageSize });
});

adminUsers.get("/:id", async (c) => {
	const db = createDb(c.env);
	const user = await findUser(c, c.req.param("id"));
	const lastSignOutQuery = () =>
		db.selectFrom("login_events").select("created_at").where("user_id", "=", user.id).where("success", "=", dbBool(true)).where("event", "=", "sign-out").orderBy("created_at", "desc").limit(1).executeTakeFirst();
	const [accounts, sessions, lastSignOut, [detail], events] = await Promise.all([
		db.selectFrom("accounts").select("providerId").where("userId", "=", user.id).execute(),
		db.selectFrom("sessions").select((eb) => eb.fn.countAll<number>().as("n")).where("userId", "=", user.id).executeTakeFirst(),
		lastSignOutQuery(),
		present(c, [user]),
		createDb(c.env).selectFrom("login_events").select((eb) => eb.fn.countAll<number>().as("n")).where("user_id", "=", user.id).executeTakeFirst(),
	]);
	return c.json<AdminUserDetail>({
		activityCount: Number(events?.n ?? 0),
		...detail,
		signInMethods: accounts.map((a) => a.providerId),
		activeSessions: Number(sessions?.n ?? 0),
		lastSignOutAt: lastSignOut ? (toIso(lastSignOut.created_at) ?? null) : null,
	});
});

/** `GET /:id/activity?page=1&pageSize=10&sort=&dir=`: the user's sign-ins (failed ones too) and sign-outs, newest first unless sorted. Pruned like the rest of `login_events`. */
adminUsers.get("/:id/activity", async (c) => {
	const user = await findUser(c, c.req.param("id"));
	const page = Math.max(1, Number(c.req.query("page")) || 1);
	const pageSize = Math.min(100, Math.max(1, Number(c.req.query("pageSize")) || 10));
	const sortParam = c.req.query("sort") as ActivitySortField;
	const sort = ACTIVITY_SORT_FIELDS.includes(sortParam) ? sortParam : "createdAt";
	const sign = c.req.query("sort") && c.req.query("dir") === "asc" ? 1 : -1;
	const rows = await createDb(c.env)
		.selectFrom("login_events")
		.select(["id", "success", "event", "ip", "country", "user_agent", "created_at"])
		.where("user_id", "=", user.id)
		.orderBy("created_at", "desc")
		.orderBy("id")
		.execute();
	const all: ActivityEvent[] = rows.map((r) => ({
		id: r.id,
		kind: r.event === "sign-in" || !r.event ? (r.success ? "sign-in" : "failed") : r.event,
		ip: r.ip,
		country: r.country,
		userAgent: r.user_agent,
		createdAt: toIso(r.created_at) ?? "",
	}));
	// Sorted here, not in SQL: the browser is read from the User-Agent, and the log is short (pruned). Empty values come last.
	if (c.req.query("sort") && sort !== "createdAt") {
		const key = (e: ActivityEvent): string | null =>
			sort === "kind" ? e.kind : sort === "ip" ? e.ip : sort === "country" ? e.country : e.userAgent ? describeBrowser(e.userAgent) : null;
		all.sort((a, b) => {
			const ka = key(a);
			const kb = key(b);
			if (ka === null || kb === null) return ka === kb ? 0 : ka === null ? 1 : -1;
			return sign * ka.localeCompare(kb);
		});
	} else if (c.req.query("sort") && sign === 1) {
		all.reverse();
	}
	const events = all.slice((page - 1) * pageSize, page * pageSize);
	return c.json<AdminUserActivity>({ events, total: all.length, page, pageSize });
});

adminUsers.post("/", async (c) => {
	const input = await parseBody(c, createUserSchema);
	await assertEmailFree(c, input.email);
	const id = await createPasswordUser(createDb(c.env), { ...input, name: input.name || null });
	return c.json((await present(c, [await findUser(c, id)]))[0], 201);
});

adminUsers.patch("/:id", async (c) => {
	const db = createDb(c.env);
	const me = c.get("user");
	const user = await findUser(c, c.req.param("id"));
	const input = await parseBody(c, updateUserSchema);

	const changesRole = input.role !== undefined && input.role !== user.role;
	const deactivates = input.emailVerified === false && Boolean(user.emailVerified);
	if (user.id === me?.id && (changesRole || deactivates)) {
		throw new AppError(403, "You can't change your own role or deactivate yourself.", { code: "self_change" });
	}
	if (changesRole && (await wouldRemoveLastAdmin(db, user, input.role!))) {
		throw new AppError(409, "This is the last administrator: give another user that role first.", { code: "last_admin" });
	}
	if (input.email && input.email !== user.email) await assertEmailFree(c, input.email, user.id);

	const fields: Updateable<Database["users"]> = { updatedAt: dbNow() };
	if (input.name !== undefined) fields.name = input.name || null;
	if (input.email !== undefined) fields.email = input.email;
	if (input.role !== undefined) fields.role = input.role;
	if (input.emailVerified !== undefined) fields.emailVerified = dbBool(input.emailVerified);
	await db.updateTable("users").set(fields).where("id", "=", user.id).execute();

	if (input.password) await setPassword(db, { id: user.id, email: input.email ?? user.email }, input.password);

	// Whatever takes access away signs the user out everywhere.
	const downgraded = changesRole && !hasRole(input.role, user.role as Role);
	if (input.password || downgraded || deactivates) await revokeSessions(db, user.id);

	return c.json((await present(c, [await findUser(c, user.id)]))[0]);
});

adminUsers.delete("/:id", async (c) => {
	const db = createDb(c.env);
	const user = await findUser(c, c.req.param("id"));
	if (user.id === c.get("user")?.id) {
		throw new AppError(403, "You can't delete your own account here. Use your profile page.", { code: "self_change" });
	}
	if (await wouldRemoveLastAdmin(db, user, null)) {
		throw new AppError(409, "This is the last administrator: give another user that role first.", { code: "last_admin" });
	}
	await deleteUser(db, user);
	return c.body(null, 204);
});
