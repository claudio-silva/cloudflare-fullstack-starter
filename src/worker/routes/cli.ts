import { Hono } from "hono";
import type { Next } from "hono";
import bcrypt from "bcryptjs";
import { sql, type Updateable } from "kysely";
import type { Database } from "../types/database";
import type { AppBindings, AppContext } from "../types/context";
import { createDb, databaseKind, dbBool, dbNow, toIso } from "../db";
import { createPasswordUser, deleteUser, revokeSessions, wouldRemoveLastAdmin } from "../lib/users";
import { requestOrigin } from "../lib/login-log";
import { ROLES, hasRole, type Role } from "../../shared/roles";
import { appliedMigrations, clearTable, describeSchema, exportRows, finishTable, importRows, restoreChunkRows, type EncodedRow } from "../db/backup";
import { migrateDatabase, migrationStatus, pendingMigrations } from "../db/migrations";
import { readJournal } from "../db/migrations/journal";
import { schemaSnapshot } from "../db/schema-snapshot";
import type { MigrationCompatibility } from "../db/migrations/types";
import { seeds } from "../db/seeds";
import { createEmailSender } from "../adapters/email";
import { config } from "../../config";

const ALLOWED_ROLES = ROLES;
type UserRole = Role;

/** A role change that takes something away signs the user out everywhere. */
const isDowngrade = (from: string, to: string) => from !== to && !hasRole(to, from as Role);

const safeEqual = (a: string, b: string): boolean => {
	if (a.length !== b.length) return false;
	let result = 0;
	for (let i = 0; i < a.length; i += 1) {
		result |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return result === 0;
};

// CLI auth middleware — requires a shared `x-api-key` header matching
// `CLI_API_KEY` in every environment. Fails closed if the key is not configured.
const cliAuthMiddleware = async (c: AppContext, next: Next) => {
	const expected = c.env.CLI_API_KEY;
	if (!expected) {
		console.error("[CLI] CLI_API_KEY is not configured on the worker");
		return c.json({ error: "CLI API is not configured on the server" }, 500);
	}
	const presented = c.req.header("x-api-key") || c.req.header("X-Api-Key") || "";
	if (!presented || !safeEqual(presented, expected)) {
		return c.json({ error: "Invalid or missing CLI API key" }, 401);
	}
	await next();
};


/** CLI management routes, mounted at `/api/cli`. */
export const cli = new Hono<AppBindings>();

cli.use("*", cliAuthMiddleware);

cli.get("/users", async (c) => {
	const { search, limit } = c.req.query();
	const limitNum = limit ? parseInt(limit, 10) : 50;
	const db = createDb(c.env);

	let query = db.selectFrom("users").selectAll().orderBy("createdAt", "desc").limit(limitNum);
	if (search) {
		query = query.where((eb) =>
			eb.or([
				eb(sql`lower(${eb.ref("email")})`, "like", `%${search.toLowerCase()}%`),
				eb(sql`lower(${eb.ref("name")})`, "like", `%${search.toLowerCase()}%`),
			]),
		);
	}

	const users = await query.execute();
	return c.json({
		users: users.map((u) => ({
			id: u.id,
			email: u.email,
			name: u.name,
			role: u.role,
			emailVerified: Boolean(u.emailVerified),
			createdAt: toIso(u.createdAt),
			updatedAt: toIso(u.updatedAt),
		})),
	});
});

cli.get("/users/:email", async (c) => {
	const email = c.req.param("email");
	if (!email) return c.json({ error: "Email is required" }, 400);
	const db = createDb(c.env);

	const user = await db.selectFrom("users").where("email", "=", email).selectAll().executeTakeFirst();
	if (!user) {
		return c.json({ error: "User not found" }, 404);
	}

	const account = await db
		.selectFrom("accounts")
		.where("userId", "=", user.id)
		.where("providerId", "=", "credential")
		.selectAll()
		.executeTakeFirst();

	const sessionCount = await db
		.selectFrom("sessions")
		.where("userId", "=", user.id)
		.select(db.fn.count("id").as("count"))
		.executeTakeFirst();

	return c.json({
		user: {
			id: user.id,
			email: user.email,
			name: user.name,
			role: user.role,
			image: user.image,
			emailVerified: Boolean(user.emailVerified),
			createdAt: toIso(user.createdAt),
			updatedAt: toIso(user.updatedAt),
		},
		account: account
			? {
					accountId: account.accountId,
					providerId: account.providerId,
					hasPassword: !!account.password,
					createdAt: toIso(account.createdAt),
					updatedAt: toIso(account.updatedAt),
			  }
			: null,
		activeSessions: Number(sessionCount?.count || 0),
	});
});

cli.post("/users", async (c) => {
	const { email, password, name, role } = await c.req.json<{
		email: string;
		password: string;
		name?: string;
		role?: string;
	}>();
	if (!email || !password) {
		return c.json({ error: "Email and password are required" }, 400);
	}
	if (password.length < 8) {
		return c.json({ error: "Password must be at least 8 characters" }, 400);
	}
	if (role && !ALLOWED_ROLES.includes(role as UserRole)) {
		return c.json({ error: `Invalid role. Allowed: ${ALLOWED_ROLES.join(", ")}` }, 400);
	}

	const db = createDb(c.env);
	const existing = await db.selectFrom("users").where("email", "=", email).select("id").executeTakeFirst();
	if (existing) {
		return c.json({ error: "User already exists" }, 409);
	}

	const userId = await createPasswordUser(db, { email, password, name, role: (role as UserRole) || "user" });

	return c.json({ success: true, userId, message: "User created successfully" });
});

cli.put("/users/:email/password", async (c) => {
	const email = c.req.param("email");
	if (!email) return c.json({ error: "Email is required" }, 400);
	const { password } = await c.req.json<{ password: string }>();
	if (!password || password.length < 8) {
		return c.json({ error: "Password must be at least 8 characters" }, 400);
	}

	const db = createDb(c.env);
	const user = await db.selectFrom("users").where("email", "=", email).select("id").executeTakeFirst();
	if (!user) {
		return c.json({ error: "User not found" }, 404);
	}

	const hashedPassword = await bcrypt.hash(password, 10);
	await db
		.updateTable("accounts")
		.set({ password: hashedPassword, updatedAt: dbNow() })
		.where("userId", "=", user.id)
		.where("providerId", "=", "credential")
		.execute();

	return c.json({ success: true, message: "Password updated successfully" });
});

cli.put("/users/:email", async (c) => {
	const currentEmail = c.req.param("email");
	if (!currentEmail) return c.json({ error: "Email is required" }, 400);
	const updateData = await c.req.json<{ name?: string; email?: string; password?: string; role?: string }>();
	if (!updateData.name && !updateData.email && !updateData.password && !updateData.role) {
		return c.json({ error: "No fields to update" }, 400);
	}

	if (updateData.role && !ALLOWED_ROLES.includes(updateData.role as UserRole)) {
		return c.json({ error: `Invalid role. Allowed: ${ALLOWED_ROLES.join(", ")}` }, 400);
	}

	const db = createDb(c.env);
	const user = await db
		.selectFrom("users")
		.where("email", "=", currentEmail)
		.select(["id", "role"])
		.executeTakeFirst();
	if (!user) {
		return c.json({ error: "User not found" }, 404);
	}

	if (updateData.email) {
		const exists = await db
			.selectFrom("users")
			.where("email", "=", updateData.email)
			.where("id", "!=", user.id)
			.select("id")
			.executeTakeFirst();
		if (exists) {
			return c.json({ error: "Email address already in use" }, 409);
		}
	}

	if (updateData.password && updateData.password.length < 8) {
		return c.json({ error: "Password must be at least 8 characters" }, 400);
	}

	// Prevent demoting the last admin
	if (updateData.role && (await wouldRemoveLastAdmin(db, user, updateData.role))) {
		return c.json({ error: "Cannot demote the last admin" }, 400);
	}

	if (updateData.password) {
		const hashed = await bcrypt.hash(updateData.password, 10);
		await db
			.updateTable("accounts")
			.set({ password: hashed, updatedAt: dbNow() })
			.where("userId", "=", user.id)
			.where("providerId", "=", "credential")
			.execute();
	}

	const updateFields: Updateable<Database["users"]> = { updatedAt: dbNow() };
	if (updateData.name !== undefined) updateFields.name = updateData.name;
	if (updateData.email) updateFields.email = updateData.email;
	if (updateData.role) updateFields.role = updateData.role as UserRole;

	if (Object.keys(updateFields).length > 1) {
		await db.updateTable("users").set(updateFields).where("id", "=", user.id).execute();
	}

	// Revoke sessions when the role is downgraded
	if (updateData.role && isDowngrade(user.role, updateData.role)) {
		await revokeSessions(db, user.id);
	}

	return c.json({
		success: true,
		message: "User updated successfully",
		user: { email: updateData.email || currentEmail },
	});
});

cli.put("/users/:email/role", async (c) => {
	const email = c.req.param("email");
	if (!email) return c.json({ error: "Email is required" }, 400);
	const { role } = await c.req.json<{ role: string }>();
	if (!role || !ALLOWED_ROLES.includes(role as UserRole)) {
		return c.json({ error: `Invalid role. Allowed: ${ALLOWED_ROLES.join(", ")}` }, 400);
	}
	const db = createDb(c.env);
	const user = await db.selectFrom("users").where("email", "=", email).selectAll().executeTakeFirst();
	if (!user) {
		return c.json({ error: "User not found" }, 404);
	}
	if (await wouldRemoveLastAdmin(db, user, role)) {
		return c.json({ error: "Cannot demote the last admin" }, 400);
	}
	await db.updateTable("users").set({ role, updatedAt: dbNow() }).where("id", "=", user.id).execute();
	if (isDowngrade(user.role, role)) {
		await revokeSessions(db, user.id);
	}
	return c.json({ success: true, message: `Role set to ${role}` });
});

cli.put("/users/:email/activate", async (c) => {
	const email = c.req.param("email");
	if (!email) return c.json({ error: "Email is required" }, 400);
	const { activated } = await c.req.json<{ activated: boolean }>();
	if (typeof activated !== "boolean") {
		return c.json({ error: "activated must be a boolean" }, 400);
	}

	const db = createDb(c.env);
	const user = await db.selectFrom("users").where("email", "=", email).select("id").executeTakeFirst();
	if (!user) {
		return c.json({ error: "User not found" }, 404);
	}

	await db
		.updateTable("users")
		.set({ emailVerified: dbBool(activated), updatedAt: dbNow() })
		.where("id", "=", user.id)
		.execute();

	return c.json({ success: true, message: `User ${activated ? "activated" : "deactivated"} successfully` });
});

cli.delete("/users/:email", async (c) => {
	const email = c.req.param("email");
	if (!email) return c.json({ error: "Email is required" }, 400);
	const db = createDb(c.env);

	const user = await db.selectFrom("users").where("email", "=", email).select(["id", "email"]).executeTakeFirst();
	if (!user) {
		return c.json({ error: "User not found" }, 404);
	}

	await deleteUser(db, user, requestOrigin(c));

	return c.json({ success: true, message: "User deleted successfully" });
});

cli.delete("/users", async (c) => {
	const db = createDb(c.env);
	await db.deleteFrom("sessions").execute();
	await db.deleteFrom("verifications").execute();
	await db.deleteFrom("accounts").execute();
	const deleted = await db.deleteFrom("users").execute();
	return c.json({ success: true, message: "Deleted all users", deletedCount: deleted.length || 0 });
});

// Database administration (same API-key protection as user management).
cli.post("/migrate", async (c) => {
	const db = createDb(c.env);
	// `only` runs one phase of the expand/contract split: the deploy applies
	// `expand` before replacing the code and `contract` after it.
	type MigrateBody = { only?: MigrationCompatibility[] };
	const body: MigrateBody = await c.req.json<MigrateBody>().catch(() => ({}) as MigrateBody);
	try {
		return c.json(await migrateDatabase(db, { kind: databaseKind, only: body.only }));
	} catch (error) {
		console.error("[CLI] Migration failed", error);
		return c.json({ error: error instanceof Error ? error.message : "Migration failed" }, 500);
	}
});

cli.get("/migrations", async (c) => {
	return c.json({ migrations: await migrationStatus(createDb(c.env), databaseKind) });
});

/** Pending migrations with their compatibility, so a deploy can order itself. */
cli.get("/migrations/pending", async (c) => {
	return c.json({ pending: await pendingMigrations(createDb(c.env), databaseKind) });
});

/** What each migration run did — the record a failed run leaves behind. */
cli.get("/migrations/journal", async (c) => {
	const limit = Number(c.req.query("limit") ?? 20);
	return c.json({ entries: await readJournal(createDb(c.env), limit) });
});

/**
 * Report a failed deploy by email. Reachable during a maintenance window
 * because `/api/cli/` is in `maintenance.bypassPaths`.
 */
cli.post("/deploy-report", async (c) => {
	const to = config.email.deployReportsTo;
	if (!to) return c.json({ sent: false, reason: "config.email.deployReportsTo is empty" });
	const { environment, version, stage, error } = await c.req.json<{
		environment?: string;
		version?: string;
		stage?: string;
		error?: string;
	}>();
	const subject = `[${config.appName}] deploy to ${environment ?? "?"} failed at ${stage ?? "?"}`;
	const html =
		`<p>The deploy of <strong>${version ?? "?"}</strong> to <strong>${environment ?? "?"}</strong> ` +
		`failed during <strong>${stage ?? "?"}</strong>.</p><pre>${(error ?? "").slice(0, 4000)}</pre>` +
		`<p>If a maintenance window was opened it is still open, on purpose. ` +
		`Check <code>npm run db -- journal --env ${environment ?? "production"}</code> before deciding how to recover.</p>`;
	try {
		await createEmailSender(c.env).sendEmail({ to, subject, html });
		return c.json({ sent: true });
	} catch (error) {
		console.error("[CLI] Deploy report failed to send", error);
		return c.json({ sent: false, reason: error instanceof Error ? error.message : "send failed" });
	}
});

/**
 * Recent sign-in attempts, and a rolling count. Answers "how many people are
 * actually using this" without a dashboard, and shows a password being guessed
 * at before anyone notices another way.
 */
cli.get("/login-events", async (c) => {
	const db = createDb(c.env);
	const limit = Math.min(Number(c.req.query("limit") ?? 50), 500);
	const rows = await db
		.selectFrom("login_events")
		.selectAll()
		.orderBy("created_at", "desc")
		.limit(limit)
		.execute();
	const totals = await db
		.selectFrom("login_events")
		.select((eb) => [
			eb.fn.countAll().as("attempts"),
			eb.fn.count("user_id").distinct().as("distinct_users"),
		])
		.executeTakeFirst();
	return c.json({
		events: rows.map((r) => ({ ...r, success: Boolean(r.success), created_at: toIso(r.created_at) })),
		totals: {
			attempts: Number(totals?.attempts ?? 0),
			distinctUsers: Number(totals?.distinct_users ?? 0),
		},
	});
});

/** Portable schema description, compared against the committed snapshot. */
cli.get("/schema", async (c) => {
	return c.json({ schema: await schemaSnapshot(createDb(c.env)) });
});

cli.get("/seeds", (c) => c.json({ seeds: Object.keys(seeds) }));

cli.post("/seed", async (c) => {
	const { name } = await c.req.json<{ name?: string }>();
	const seed = name ? seeds[name] : undefined;
	if (!name || !seed) {
		return c.json({ error: `Unknown seed "${name ?? ""}". Available: ${Object.keys(seeds).join(", ") || "(none)"}` }, 404);
	}
	await seed(createDb(c.env), { kind: databaseKind });
	return c.json({ success: true, seed: name });
});

// Backup and restore (database-agnostic; driven by `npm run db:backup` / `db:restore`, see docs/DATABASES.md).
cli.get("/backup/info", async (c) => {
	const db = createDb(c.env);
	const tables = await describeSchema(db, databaseKind);
	return c.json({
		kind: databaseKind,
		migrations: await appliedMigrations(db),
		tables: tables.map((t) => ({
			name: t.name,
			columns: t.columns.map((col) => col.name),
			primaryKey: t.primaryKey,
			restoreChunkRows: restoreChunkRows(databaseKind, t),
		})),
	});
});

/** Looks the table up in the live schema, which also validates the name taken from the request. */
async function findTable(c: AppContext, name: string | undefined) {
	return (await describeSchema(createDb(c.env), databaseKind)).find((t) => t.name === name);
}

cli.get("/backup/rows", async (c) => {
	const { table: name, offset, limit } = c.req.query();
	const table = await findTable(c, name);
	if (!table) return c.json({ error: `Unknown table "${name ?? ""}"` }, 404);
	const rows = await exportRows(createDb(c.env), table, Math.max(0, Number(offset) || 0), Math.min(1000, Math.max(1, Number(limit) || 500)));
	return c.json({ rows });
});

cli.post("/restore/clear", async (c) => {
	const { table: name } = await c.req.json<{ table?: string }>();
	const table = await findTable(c, name);
	if (!table) return c.json({ error: `Unknown table "${name ?? ""}"` }, 404);
	await clearTable(createDb(c.env), table);
	return c.json({ success: true });
});

cli.post("/restore/rows", async (c) => {
	const { table: name, rows } = await c.req.json<{ table?: string; rows?: EncodedRow[] }>();
	const table = await findTable(c, name);
	if (!table || !Array.isArray(rows)) return c.json({ error: `Unknown table "${name ?? ""}" or missing rows` }, 400);
	try {
		await importRows(createDb(c.env), databaseKind, table, rows);
	} catch (error) {
		console.error("[CLI] Restore failed", error);
		return c.json({ error: error instanceof Error ? error.message : "Restore failed" }, 500);
	}
	return c.json({ success: true, inserted: rows.length });
});

cli.post("/restore/finish", async (c) => {
	const { table: name } = await c.req.json<{ table?: string }>();
	const table = await findTable(c, name);
	if (!table) return c.json({ error: `Unknown table "${name ?? ""}"` }, 404);
	return c.json(await finishTable(createDb(c.env), databaseKind, table));
});
