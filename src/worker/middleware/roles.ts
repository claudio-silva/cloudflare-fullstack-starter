import type { Next } from "hono";
import type { AppContext } from "../types/context";
import { fail } from "../lib/errors";
import { hasRole, type Role } from "../../shared/roles";

/**
 * Refuses with 403 unless the signed-in user has `minimum` or a higher role
 * (src/shared/roles.ts). Goes after `authMiddleware`, which sets the user:
 *
 *   items.use("*", authMiddleware, requireRole("admin"));
 */
export function requireRole(minimum: Role) {
	return async (c: AppContext, next: Next) => {
		const user = c.get("user");
		if (!hasRole(user?.role, minimum)) {
			return fail(c, 403, "You don't have access to this area.", {
				code: "forbidden",
				log: `user ${user?.id ?? "?"} (role ${user?.role ?? "none"}) needs ${minimum} for ${c.req.method} ${c.req.path}`,
			});
		}
		await next();
	};
}
