import { Hono } from "hono";
import type { Next } from "hono";
import { Kysely } from "kysely";
import { D1Dialect } from "kysely-d1";
import bcrypt from "bcryptjs";
import type { Database } from "./types/database";
import type { AppBindings, AppContext } from "./types/context";
import { authMiddleware, createAuth, handleAuthRequest } from "./middleware/auth";

const app = new Hono<AppBindings>();

const requireDb = (c: AppContext) => {
	if (!c.env.DB) {
		throw new Error("Database binding unavailable");
	}
	return c.env.DB;
};

// Health check
app.get("/api/", (c) => {
	const environment = c.env.ENVIRONMENT || "local";
	return c.json({ name: "Cloudflare Fullstack Starter", environment, status: "healthy" });
});

// Auth routes
app.all("/api/auth/*", (c) => handleAuthRequest(c));

// CLI auth middleware (local open, remote requires session)
const cliAuthMiddleware = async (c: AppContext, next: Next) => {
	const environment = c.env.ENVIRONMENT || "local";
	if (environment === "local") {
		await next();
		return;
	}
	const auth = createAuth(c);
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) {
		return c.json({ error: "Admin authentication required for CLI operations in remote environments" }, 401);
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
	const { email, password, name } = await c.req.json<{ email: string; password: string; name?: string }>();
	if (!email || !password) {
		return c.json({ error: "Email and password are required" }, 400);
	}
	if (password.length < 8) {
		return c.json({ error: "Password must be at least 8 characters" }, 400);
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
	const updateData = await c.req.json<{ name?: string; email?: string; password?: string }>();
	if (!updateData.name && !updateData.email && !updateData.password) {
		return c.json({ error: "No fields to update" }, 400);
	}

	const db = new Kysely<Database>({ dialect: new D1Dialect({ database: requireDb(c) }) });
	const user = await db.selectFrom("users").where("email", "=", currentEmail).select("id").executeTakeFirst();
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

	if (Object.keys(updateFields).length > 1) {
		await db.updateTable("users").set(updateFields).where("id", "=", user.id).execute();
	}

	return c.json({
		success: true,
		message: "User updated successfully",
		user: { email: updateData.email || currentEmail },
	});
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
