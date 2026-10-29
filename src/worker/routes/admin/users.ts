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
	type AdminUser,
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

const toAdminUser = (u: UserRow): AdminUser => ({
	id: u.id,
	name: u.name,
	email: u.email,
	role: u.role,
	emailVerified: Boolean(u.emailVerified),
	createdAt: toIso(u.createdAt) ?? "",
	updatedAt: toIso(u.updatedAt) ?? "",
});

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

	const [rows, count] = await Promise.all([
		filtered
			.select(["id", "name", "email", "role", "emailVerified", "createdAt", "updatedAt"])
			.orderBy(sort, dir)
			.orderBy("id")
			.limit(pageSize)
			.offset((page - 1) * pageSize)
			.execute(),
		filtered.select((eb) => eb.fn.countAll<number>().as("total")).executeTakeFirst(),
	]);

	return c.json<AdminUserList>({ users: rows.map(toAdminUser), total: Number(count?.total ?? 0), page, pageSize });
});

adminUsers.get("/:id", async (c) => {
	const db = createDb(c.env);
	const user = await findUser(c, c.req.param("id"));
	const [accounts, sessions, lastSignIn] = await Promise.all([
		db.selectFrom("accounts").select("providerId").where("userId", "=", user.id).execute(),
		db.selectFrom("sessions").select((eb) => eb.fn.countAll<number>().as("n")).where("userId", "=", user.id).executeTakeFirst(),
		db
			.selectFrom("login_events")
			.select("created_at")
			.where("user_id", "=", user.id)
			.where("success", "=", dbBool(true))
			.orderBy("created_at", "desc")
			.limit(1)
			.executeTakeFirst(),
	]);
	return c.json<AdminUserDetail>({
		...toAdminUser(user),
		signInMethods: accounts.map((a) => a.providerId),
		activeSessions: Number(sessions?.n ?? 0),
		lastSignInAt: lastSignIn ? (toIso(lastSignIn.created_at) ?? null) : null,
	});
});

adminUsers.post("/", async (c) => {
	const input = await parseBody(c, createUserSchema);
	await assertEmailFree(c, input.email);
	const id = await createPasswordUser(createDb(c.env), { ...input, name: input.name || null });
	return c.json(toAdminUser(await findUser(c, id)), 201);
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

	return c.json(toAdminUser(await findUser(c, user.id)));
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
