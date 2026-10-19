import { Hono } from "hono";
import type { AppBindings } from "../types/context";
import { authMiddleware } from "../middleware/auth";
import { createDb } from "../db";

/** Authenticated user routes, mounted at `/api`. */
export const profile = new Hono<AppBindings>();

// Example protected route
profile.get("/protected/ping", authMiddleware, (c) => {
	const user = c.get("user");
	return c.json({ ok: true, user });
});

// Profile deletion endpoint (authenticated users can delete their own account)
profile.delete("/profile", authMiddleware, async (c) => {
	const user = c.get("user");
	if (!user?.id) {
		return c.json({ error: "User not authenticated" }, 401);
	}

	const db = createDb(c.env);

	// Delete all user data
	await db.deleteFrom("sessions").where("userId", "=", user.id).execute();
	await db.deleteFrom("verifications").where("identifier", "=", user.email).execute();
	await db.deleteFrom("accounts").where("userId", "=", user.id).execute();
	await db.deleteFrom("users").where("id", "=", user.id).execute();

	return c.json({ success: true, message: "Account deleted successfully" });
});
