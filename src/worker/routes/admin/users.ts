import { Hono } from "hono";
import { sql, type Selectable, type Updateable } from "kysely";
import type { z } from "zod";
import type { AppBindings, AppContext } from "../../types/context";
import type { Database } from "../../types/database";
import { createDb, databaseKind, dbBool, dbNow, dbSecondsBetween, toIso } from "../../db";
import { AppError } from "../../lib/errors";
import { requireRole } from "../../middleware/roles";
import { createPasswordUser, deleteUser, revokeSessions, setPassword, wouldRemoveLastAdmin } from "../../lib/users";
import { requestOrigin } from "../../lib/login-log";
import { hasRole, type Role } from "../../../shared/roles";
import {
	IDLE_AFTER_SECONDS,
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

type Db = ReturnType<typeof createDb>;
type UserRow = Pick<Selectable<Database["users"]>, "id" | "name" | "email" | "role" | "image" | "emailVerified" | "disabled" | "createdAt" | "updatedAt">;

const seconds = (from: Date | string, to: Date | string | number) => Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 1000));

/**
 * For each user with live sessions: seconds since the most recent was last
 * used, and how long the open ones have lasted so far (to their last use).
 */
async function liveSessionsFor(db: Db, ids: string[]): Promise<Map<string, { idle: number; seconds: number }>> {
	const live = new Map<string, { idle: number; seconds: number }>();
	if (ids.length === 0) return live;
	const now = Date.now();
	const sessions = await db.selectFrom("sessions").select(["userId", "createdAt", "updatedAt", "expiresAt"]).where("userId", "in", ids).execute();
	for (const s of sessions) {
		if (new Date(s.expiresAt).getTime() <= now) continue;
		const known = live.get(s.userId);
		const idle = seconds(s.updatedAt, now);
		live.set(s.userId, { idle: Math.min(idle, known?.idle ?? Infinity), seconds: (known?.seconds ?? 0) + seconds(s.createdAt, s.updatedAt) });
	}
	return live;
}

async function statsFor(db: Db, ids: string[]) {
	if (ids.length === 0) return new Map<string, Selectable<Database["user_stats"]>>();
	const rows = await db.selectFrom("user_stats").selectAll().where("user_id", "in", ids).execute();
	return new Map(rows.map((r) => [r.user_id, r]));
}

async function present(c: AppContext, rows: UserRow[]): Promise<AdminUser[]> {
	const db = createDb(c.env);
	const ids = rows.map((u) => u.id);
	const [live, stats] = await Promise.all([liveSessionsFor(db, ids), statsFor(db, ids)]);
	return rows.map((u) => {
		const now = live.get(u.id);
		const idleSeconds = now?.idle ?? null;
		const enabled = !u.disabled;
		const emailVerified = Boolean(u.emailVerified);
		return {
			id: u.id,
			name: u.name,
			email: u.email,
			role: u.role,
			image: u.image,
			enabled,
			emailVerified,
			status: userStatus({ enabled, emailVerified }, idleSeconds),
			idleSeconds,
			lastSignInAt: toIso(stats.get(u.id)?.last_sign_in_at ?? null) ?? null,
			usageSeconds: Number(stats.get(u.id)?.session_seconds ?? 0) + (now?.seconds ?? 0),
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

const USER_COLUMNS = ["users.id", "users.name", "users.email", "users.role", "users.image", "users.emailVerified", "users.disabled", "users.createdAt", "users.updatedAt"] as const;

/**
 * `GET /?q=&page=1&pageSize=20&sort=createdAt&dir=desc`
 *
 * Every sort is done in SQL, so the list stays one query however many users
 * there are: `users` joined to the live sessions (last use) and `user_stats`
 * (last sign-in, time in session). Empty values come last in either direction.
 * Time in session counts the open sessions too, up to their last use.
 */
adminUsers.get("/", async (c) => {
	const db = createDb(c.env);
	const q = c.req.query("q")?.trim().toLowerCase();
	const page = Math.max(1, Number(c.req.query("page")) || 1);
	// D1 binds at most 100 parameters per query, and a page's ids are bound in `present`.
	const pageSize = Math.min(50, Math.max(1, Number(c.req.query("pageSize")) || 20));
	const sortParam = c.req.query("sort") as UserSortField;
	const sort = USER_SORT_FIELDS.includes(sortParam) ? sortParam : "createdAt";
	const dir = c.req.query("dir") === "asc" ? "asc" : "desc";

	const now = new Date();
	const live = db
		.selectFrom("sessions")
		.select(["userId", (eb) => eb.fn.max("updatedAt").as("lastSeen"), (eb) => eb.fn.sum<number>(dbSecondsBetween("createdAt", "updatedAt")).as("liveSeconds")])
		.where("expiresAt", ">", dbNow())
		.groupBy("userId")
		.as("live");
	const idleCutoff = databaseKind === "sqlite" ? new Date(now.getTime() - IDLE_AFTER_SECONDS * 1000).toISOString() : new Date(now.getTime() - IDLE_AFTER_SECONDS * 1000);

	let filtered = db.selectFrom("users").leftJoin(live, "live.userId", "users.id").leftJoin("user_stats", "user_stats.user_id", "users.id");
	if (q) {
		filtered = filtered.where((eb) =>
			eb.or([eb(sql`lower(${eb.ref("users.email")})`, "like", `%${q}%`), eb(sql`lower(${eb.ref("users.name")})`, "like", `%${q}%`)]),
		);
	}

	// What each sort orders by, and whether "ascending" runs the other way (idle time is the age of the last use).
	const key = (() => {
		switch (sort) {
			case "status":
				// active, idle, unverified, disabled; no session last.
				return sql`case
					when ${sql.ref("users.disabled")} = ${dbBool(true)} then 3
					when ${sql.ref("live.lastSeen")} is not null and ${sql.ref("live.lastSeen")} >= ${idleCutoff} then 0
					when ${sql.ref("live.lastSeen")} is not null then 1
					when ${sql.ref("users.emailVerified")} is null or ${sql.ref("users.emailVerified")} = ${dbBool(false)} then 2
					end`;
			case "lastSignInAt":
				return sql`${sql.ref("user_stats.last_sign_in_at")}`;
			case "idleSeconds":
				return sql`${sql.ref("live.lastSeen")}`;
			case "usageSeconds":
				return sql`nullif(coalesce(${sql.ref("user_stats.session_seconds")}, 0) + coalesce(${sql.ref("live.liveSeconds")}, 0), 0)`;
			default:
				return sql`${sql.ref(`users.${sort}`)}`;
		}
	})();
	const keyDir = sort === "idleSeconds" ? (dir === "asc" ? "desc" : "asc") : dir;

	const [rows, count] = await Promise.all([
		filtered
			.select(USER_COLUMNS)
			.orderBy(sql`case when ${key} is null then 1 else 0 end`)
			.orderBy(key, keyDir)
			.orderBy("users.createdAt", "desc")
			.orderBy("users.id")
			.limit(pageSize)
			.offset((page - 1) * pageSize)
			.execute(),
		db
			.selectFrom("users")
			.$if(Boolean(q), (qb) =>
				qb.where((eb) => eb.or([eb(sql`lower(${eb.ref("email")})`, "like", `%${q}%`), eb(sql`lower(${eb.ref("name")})`, "like", `%${q}%`)])),
			)
			.select((eb) => eb.fn.countAll<number>().as("total"))
			.executeTakeFirst(),
	]);

	return c.json<AdminUserList>({ users: await present(c, rows), total: Number(count?.total ?? 0), page, pageSize });
});

adminUsers.get("/:id", async (c) => {
	const db = createDb(c.env);
	const user = await findUser(c, c.req.param("id"));
	const ofUser = db.selectFrom("login_events").where("user_id", "=", user.id);
	const [accounts, sessions, lastSignOut, [detail], events, stats, current, lastSignIn] = await Promise.all([
		db.selectFrom("accounts").select("providerId").where("userId", "=", user.id).execute(),
		db.selectFrom("sessions").select((eb) => eb.fn.countAll<number>().as("n")).where("userId", "=", user.id).where("expiresAt", ">", dbNow()).executeTakeFirst(),
		ofUser.select("created_at").where("event", "=", "sign-out").orderBy("created_at", "desc").limit(1).executeTakeFirst(),
		present(c, [user]),
		ofUser.select((eb) => eb.fn.countAll<number>().as("n")).executeTakeFirst(),
		db.selectFrom("user_stats").selectAll().where("user_id", "=", user.id).executeTakeFirst(),
		// The session used most recently, if any is still alive.
		db.selectFrom("sessions").select("ipAddress").where("userId", "=", user.id).where("expiresAt", ">", dbNow()).orderBy("updatedAt", "desc").limit(1).executeTakeFirst(),
		// `sessions` has no country: it is the one of the latest sign-in.
		ofUser.select("country").where("success", "=", dbBool(true)).where((eb) => eb.or([eb("event", "is", null), eb("event", "=", "sign-in")])).orderBy("created_at", "desc").limit(1).executeTakeFirst(),
	]);
	return c.json<AdminUserDetail>({
		...detail,
		signInMethods: accounts.map((a) => a.providerId),
		activeSessions: Number(sessions?.n ?? 0),
		lastSignOutAt: lastSignOut ? (toIso(lastSignOut.created_at) ?? null) : null,
		signIns: Number(stats?.sign_ins ?? 0),
		failedSignIns: Number(stats?.failed_sign_ins ?? 0),
		currentSession: current ? { ip: current.ipAddress, country: lastSignIn?.country ?? null } : null,
		activityCount: Number(events?.n ?? 0),
	});
});

/** `POST /:id/sign-out`: ends every session of the user (each one is recorded as revoked, by whoever asked). */
adminUsers.post("/:id/sign-out", async (c) => {
	const user = await findUser(c, c.req.param("id"));
	await revokeSessions(createDb(c.env), user.id, c.get("user")?.id);
	return c.body(null, 204);
});

const ACTIVITY_KINDS = ["sign-out", "session-expired", "session-revoked"] as const;

/**
 * `GET /:id/activity?page=1&pageSize=10&sort=&dir=&locale=`: the user's
 * sign-ins (failed ones too), sign-outs and ended sessions, newest first unless
 * sorted. Newest first is a page of an indexed query; other sorts read the
 * user's whole history, because the browser and the country name are worked
 * out here, not stored. Empty values come last.
 */
adminUsers.get("/:id/activity", async (c) => {
	const db = createDb(c.env);
	const user = await findUser(c, c.req.param("id"));
	const page = Math.max(1, Number(c.req.query("page")) || 1);
	const pageSize = Math.min(100, Math.max(1, Number(c.req.query("pageSize")) || 10));
	const sortParam = c.req.query("sort") as ActivitySortField;
	const sort = c.req.query("sort") && ACTIVITY_SORT_FIELDS.includes(sortParam) ? sortParam : null;
	const sign = c.req.query("dir") === "asc" ? 1 : -1;

	const ofUser = db
		.selectFrom("login_events")
		.leftJoin("users as actor", "actor.id", "login_events.actor_id")
		.where("login_events.user_id", "=", user.id)
		.where((eb) => eb.or([eb("login_events.event", "is", null), eb("login_events.event", "!=", "user-deleted")]));
	const columns = [
		"login_events.id",
		"login_events.success",
		"login_events.event",
		"login_events.ip",
		"login_events.country",
		"login_events.user_agent",
		"login_events.created_at",
		"login_events.method",
		"login_events.duration_seconds",
		"actor.email as actor",
	] as const;
	const paged = !sort || sort === "createdAt";
	const [rows, count] = await Promise.all([
		paged
			? ofUser
					.select(columns)
					.orderBy("login_events.created_at", sort && sign === 1 ? "asc" : "desc")
					.orderBy("login_events.id")
					.limit(pageSize)
					.offset((page - 1) * pageSize)
					.execute()
			: ofUser.select(columns).orderBy("login_events.created_at", "desc").orderBy("login_events.id").execute(),
		ofUser.select((eb) => eb.fn.countAll<number>().as("total")).executeTakeFirst(),
	]);
	let events: ActivityEvent[] = rows.map((r) => ({
		id: r.id,
		kind: ACTIVITY_KINDS.find((k) => k === r.event) ?? (r.success ? "sign-in" : "failed"),
		method: r.method,
		actor: r.actor,
		durationSeconds: r.duration_seconds === null ? null : Number(r.duration_seconds),
		ip: r.ip,
		country: r.country,
		userAgent: r.user_agent,
		createdAt: toIso(r.created_at) ?? "",
	}));
	if (!paged) {
		// Country names sort in the language the page shows them in.
		const names = (() => {
			try {
				return new Intl.DisplayNames([c.req.query("locale") || "en"], { type: "region" });
			} catch {
				return new Intl.DisplayNames(["en"], { type: "region" });
			}
		})();
		const key = (e: ActivityEvent): string | null =>
			sort === "kind" ? e.kind : sort === "ip" ? e.ip : sort === "country" ? (e.country ? (names.of(e.country) ?? e.country) : null) : e.userAgent ? describeBrowser(e.userAgent) : null;
		events.sort((a, b) => {
			const ka = key(a);
			const kb = key(b);
			if (ka === null || kb === null) return ka === kb ? 0 : ka === null ? 1 : -1;
			return sign * ka.localeCompare(kb);
		});
		events = events.slice((page - 1) * pageSize, page * pageSize);
	}
	return c.json<AdminUserActivity>({ events, total: Number(count?.total ?? 0), page, pageSize });
});

adminUsers.post("/", async (c) => {
	const input = await parseBody(c, createUserSchema);
	await assertEmailFree(c, input.email);
	const { enabled, ...rest } = input;
	const id = await createPasswordUser(createDb(c.env), { ...rest, name: input.name || null, disabled: !enabled });
	return c.json((await present(c, [await findUser(c, id)]))[0], 201);
});

adminUsers.patch("/:id", async (c) => {
	const db = createDb(c.env);
	const me = c.get("user");
	const user = await findUser(c, c.req.param("id"));
	const input = await parseBody(c, updateUserSchema);

	const changesRole = input.role !== undefined && input.role !== user.role;
	const disables = input.enabled === false && !user.disabled;
	if (user.id === me?.id && (changesRole || disables)) {
		throw new AppError(403, "You can't change your own role or disable yourself.", { code: "self_change" });
	}
	if ((changesRole && (await wouldRemoveLastAdmin(db, user, input.role!))) || (disables && (await wouldRemoveLastAdmin(db, user, null)))) {
		throw new AppError(409, "This is the last administrator: give another user that role first.", { code: "last_admin" });
	}
	if (input.email && input.email !== user.email) await assertEmailFree(c, input.email, user.id);

	const fields: Updateable<Database["users"]> = { updatedAt: dbNow() };
	if (input.name !== undefined) fields.name = input.name || null;
	if (input.email !== undefined) fields.email = input.email;
	if (input.role !== undefined) fields.role = input.role;
	if (input.enabled !== undefined) fields.disabled = dbBool(!input.enabled);
	if (input.emailVerified !== undefined) fields.emailVerified = dbBool(input.emailVerified);
	await db.updateTable("users").set(fields).where("id", "=", user.id).execute();

	if (input.password) await setPassword(db, { id: user.id, email: input.email ?? user.email }, input.password);

	// Whatever takes access away signs the user out everywhere.
	const downgraded = changesRole && !hasRole(input.role, user.role as Role);
	if (input.password || downgraded || disables) await revokeSessions(db, user.id, me?.id);

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
	await deleteUser(db, user, { actorId: c.get("user")?.id ?? null, origin: requestOrigin(c) });
	return c.body(null, 204);
});
