import { Hono } from "hono";
import type { Next } from "hono";
import { Kysely } from "kysely";
import { D1Dialect } from "kysely-d1";
import bcrypt from "bcryptjs";
import type { Database } from "./types/database";
import type { AppBindings, AppContext } from "./types/context";
import { authMiddleware, handleAuthRequest } from "./middleware/auth";

const app = new Hono<AppBindings>();

const requireDb = (c: AppContext) => {
	if (!c.env.DB) {
		throw new Error("Database binding unavailable");
	}
	return c.env.DB;
};

async function deleteSessionsForUser(db: Kysely<Database>, userId: string): Promise<void> {
	await db.deleteFrom("sessions").where("userId", "=", userId).execute();
}

const ALLOWED_ROLES = ["user", "admin"] as const;
type UserRole = (typeof ALLOWED_ROLES)[number];

// Health check
app.get("/api/", (c) => {
	const environment = c.env.ENVIRONMENT || "local";
	return c.json({ name: "Cloudflare Fullstack Starter", environment, status: "healthy" });
});

// Auth routes
app.all("/api/auth/*", (c) => handleAuthRequest(c));

// Constant-time string comparison to mitigate timing attacks on key checks.
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

// CLI user management endpoints
app.get("/api/cli/users", cliAuthMiddleware, async (c) => {
	const { search, limit } = c.req.query();
	const limitNum = limit ? parseInt(limit, 10) : 50;
	const db = new Kysely<Database>({ dialect: new D1Dialect({ database: requireDb(c) }) });

	let query = db.selectFrom("users").selectAll().orderBy("createdAt", "desc").limit(limitNum);
	if (search) {
		query = query.where((eb) =>
			eb.or([
				eb("email", "like", `%${search}%`),
				eb("name", "like", `%${search}%`),
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
			emailVerified: u.emailVerified,
			createdAt: u.createdAt,
			updatedAt: u.updatedAt,
		})),
	});
});

app.get("/api/cli/users/:email", cliAuthMiddleware, async (c) => {
	const email = c.req.param("email");
	const db = new Kysely<Database>({ dialect: new D1Dialect({ database: requireDb(c) }) });

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
			emailVerified: user.emailVerified,
			createdAt: user.createdAt,
			updatedAt: user.updatedAt,
		},
		account: account
			? {
					accountId: account.accountId,
					providerId: account.providerId,
					hasPassword: !!account.password,
					createdAt: account.createdAt,
					updatedAt: account.updatedAt,
			  }
			: null,
		activeSessions: Number(sessionCount?.count || 0),
	});
});

app.post("/api/cli/users", cliAuthMiddleware, async (c) => {
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

	const db = new Kysely<Database>({ dialect: new D1Dialect({ database: requireDb(c) }) });
	const existing = await db.selectFrom("users").where("email", "=", email).select("id").executeTakeFirst();
	if (existing) {
		return c.json({ error: "User already exists" }, 409);
	}

	const now = Date.now();
	const userId = crypto.randomUUID();
	const accountId = crypto.randomUUID();

	const hashedPassword = await bcrypt.hash(password, 10);

	await db
		.insertInto("users")
		.values({
			id: userId,
			email,
			name: name || null,
			image: null,
			emailVerified: 1,
			createdAt: now,
			updatedAt: now,
			role: (role as UserRole) || "user",
		})
		.execute();

	await db
		.insertInto("accounts")
		.values({
			accountId,
			id: accountId,
			userId,
			providerId: "credential",
			provider: "credential",
			providerAccountId: email,
			password: hashedPassword,
			refreshToken: null,
			accessToken: null,
			accessTokenExpiresAt: null,
			scope: null,
			createdAt: now,
			updatedAt: now,
		})
		.execute();

	return c.json({ success: true, userId, message: "User created successfully" });
});

app.put("/api/cli/users/:email/password", cliAuthMiddleware, async (c) => {
	const email = c.req.param("email");
	const { password } = await c.req.json<{ password: string }>();
	if (!password || password.length < 8) {
		return c.json({ error: "Password must be at least 8 characters" }, 400);
	}

	const db = new Kysely<Database>({ dialect: new D1Dialect({ database: requireDb(c) }) });
	const user = await db.selectFrom("users").where("email", "=", email).select("id").executeTakeFirst();
	if (!user) {
		return c.json({ error: "User not found" }, 404);
	}

	const hashedPassword = await bcrypt.hash(password, 10);
	await db
		.updateTable("accounts")
		.set({ password: hashedPassword, updatedAt: Date.now() })
		.where("userId", "=", user.id)
		.where("providerId", "=", "credential")
		.execute();

	return c.json({ success: true, message: "Password updated successfully" });
});

app.put("/api/cli/users/:email", cliAuthMiddleware, async (c) => {
	const currentEmail = c.req.param("email");
	const updateData = await c.req.json<{ name?: string; email?: string; password?: string; role?: string }>();
	if (!updateData.name && !updateData.email && !updateData.password && !updateData.role) {
		return c.json({ error: "No fields to update" }, 400);
	}

	if (updateData.role && !ALLOWED_ROLES.includes(updateData.role as UserRole)) {
		return c.json({ error: `Invalid role. Allowed: ${ALLOWED_ROLES.join(", ")}` }, 400);
	}

	const db = new Kysely<Database>({ dialect: new D1Dialect({ database: requireDb(c) }) });
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
	if (updateData.role && user.role === "admin" && updateData.role !== "admin") {
		const adminCount = await db
			.selectFrom("users")
			.where("role", "=", "admin")
			.select((eb) => eb.fn.count<number>("id").as("c"))
			.executeTakeFirst();
		if (Number(adminCount?.c ?? 0) <= 1) {
			return c.json({ error: "Cannot demote the last admin" }, 400);
		}
	}

	if (updateData.password) {
		const hashed = await bcrypt.hash(updateData.password, 10);
		await db
			.updateTable("accounts")
			.set({ password: hashed, updatedAt: Date.now() })
			.where("userId", "=", user.id)
			.where("providerId", "=", "credential")
			.execute();
	}

	const updateFields: Partial<Database["users"]> = { updatedAt: Date.now() };
	if (updateData.name !== undefined) updateFields.name = updateData.name;
	if (updateData.email) updateFields.email = updateData.email;
	if (updateData.role) updateFields.role = updateData.role as UserRole;

	if (Object.keys(updateFields).length > 1) {
		await db.updateTable("users").set(updateFields).where("id", "=", user.id).execute();
	}

	// Revoke sessions when role is downgraded to user
	if (updateData.role === "user") {
		await deleteSessionsForUser(db, user.id);
	}

	return c.json({
		success: true,
		message: "User updated successfully",
		user: { email: updateData.email || currentEmail },
	});
});

app.put("/api/cli/users/:email/role", cliAuthMiddleware, async (c) => {
	const email = c.req.param("email");
	const { role } = await c.req.json<{ role: string }>();
	if (!role || !ALLOWED_ROLES.includes(role as UserRole)) {
		return c.json({ error: `Invalid role. Allowed: ${ALLOWED_ROLES.join(", ")}` }, 400);
	}
	const db = new Kysely<Database>({ dialect: new D1Dialect({ database: requireDb(c) }) });
	const user = await db.selectFrom("users").where("email", "=", email).selectAll().executeTakeFirst();
	if (!user) {
		return c.json({ error: "User not found" }, 404);
	}
	if (user.role === "admin" && role !== "admin") {
		const adminCount = await db
			.selectFrom("users")
			.where("role", "=", "admin")
			.select((eb) => eb.fn.count<number>("id").as("c"))
			.executeTakeFirst();
		if (Number(adminCount?.c ?? 0) <= 1) {
			return c.json({ error: "Cannot demote the last admin" }, 400);
		}
	}
	await db.updateTable("users").set({ role, updatedAt: Date.now() }).where("id", "=", user.id).execute();
	if (role === "user") {
		await deleteSessionsForUser(db, user.id);
	}
	return c.json({ success: true, message: `Role set to ${role}` });
});

app.put("/api/cli/users/:email/activate", cliAuthMiddleware, async (c) => {
	const email = c.req.param("email");
	const { activated } = await c.req.json<{ activated: boolean }>();
	if (typeof activated !== "boolean") {
		return c.json({ error: "activated must be a boolean" }, 400);
	}

	const db = new Kysely<Database>({ dialect: new D1Dialect({ database: requireDb(c) }) });
	const user = await db.selectFrom("users").where("email", "=", email).select("id").executeTakeFirst();
	if (!user) {
		return c.json({ error: "User not found" }, 404);
	}

	await db
		.updateTable("users")
		.set({ emailVerified: activated ? 1 : 0, updatedAt: Date.now() })
		.where("id", "=", user.id)
		.execute();

	return c.json({ success: true, message: `User ${activated ? "activated" : "deactivated"} successfully` });
});

app.delete("/api/cli/users/:email", cliAuthMiddleware, async (c) => {
	const email = c.req.param("email");
	const db = new Kysely<Database>({ dialect: new D1Dialect({ database: requireDb(c) }) });

	const user = await db.selectFrom("users").where("email", "=", email).select("id").executeTakeFirst();
	if (!user) {
		return c.json({ error: "User not found" }, 404);
	}

	await db.deleteFrom("sessions").where("userId", "=", user.id).execute();
	await db.deleteFrom("verifications").where("identifier", "=", email).execute();
	await db.deleteFrom("accounts").where("userId", "=", user.id).execute();
	await db.deleteFrom("users").where("id", "=", user.id).execute();

	return c.json({ success: true, message: "User deleted successfully" });
});

app.delete("/api/cli/users", cliAuthMiddleware, async (c) => {
	const db = new Kysely<Database>({ dialect: new D1Dialect({ database: requireDb(c) }) });
	await db.deleteFrom("sessions").execute();
	await db.deleteFrom("verifications").execute();
	await db.deleteFrom("accounts").execute();
	const deleted = await db.deleteFrom("users").execute();
	return c.json({ success: true, message: "Deleted all users", deletedCount: deleted.length || 0 });
});

// Example protected route
app.get("/api/protected/ping", authMiddleware, (c) => {
	const user = c.get("user");
	return c.json({ ok: true, user });
});

// Profile deletion endpoint (authenticated users can delete their own account)
app.delete("/api/profile", authMiddleware, async (c) => {
	const user = c.get("user");
	if (!user?.id) {
		return c.json({ error: "User not authenticated" }, 401);
	}

	const db = new Kysely<Database>({ dialect: new D1Dialect({ database: requireDb(c) }) });

	// Delete all user data
	await db.deleteFrom("sessions").where("userId", "=", user.id).execute();
	await db.deleteFrom("verifications").where("identifier", "=", user.email).execute();
	await db.deleteFrom("accounts").where("userId", "=", user.id).execute();
	await db.deleteFrom("users").where("id", "=", user.id).execute();

	return c.json({ success: true, message: "Account deleted successfully" });
});

export default app;
