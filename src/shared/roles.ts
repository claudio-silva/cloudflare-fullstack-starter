/**
 * User roles, lowest to highest. Each role includes the ones before it, so
 * "admin or higher" is `hasRole(role, "admin")`.
 *
 * Stored as a plain string in `users.role` (no database constraint), so a
 * project can add its own: insert it in this list at the rank it belongs to.
 * A role missing from the list ranks below every other one.
 */
export const ROLES = ["user", "admin", "superadmin"] as const;

export type Role = (typeof ROLES)[number];

export const isRole = (value: unknown): value is Role => ROLES.includes(value as Role);

const rank = (role: string | null | undefined) => ROLES.indexOf(role as Role);

/** Whether `role` is `minimum` or ranks above it. */
export function hasRole(role: string | null | undefined, minimum: Role): boolean {
	return rank(role) >= rank(minimum);
}
