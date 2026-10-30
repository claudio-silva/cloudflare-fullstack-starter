import { Hono } from "hono";
import type { AppBindings } from "../../types/context";
import { authMiddleware } from "../../middleware/auth";
import { requireRole } from "../../middleware/roles";
import { adminUsers } from "./users";

/**
 * The admin area's API, mounted at `/api/admin`: admins and superadmins only,
 * 403 for anyone else. Add a module per section beside `users.ts`, and raise
 * the role on the ones that need more (as `users.ts` does).
 *
 * An example to keep, change or delete: see docs/ADMIN.md.
 */
export const admin = new Hono<AppBindings>();

admin.use("*", authMiddleware, requireRole("admin"));

admin.route("/users", adminUsers);
