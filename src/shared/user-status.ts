/**
 * What a user is doing now, from their sessions and account switches. Shared
 * by the auth CLI and the admin area (which re-exports it).
 */

/** A session untouched for this long makes its user idle rather than active. */
export const IDLE_AFTER_SECONDS = 5 * 60;

/**
 * - `active`: in session, last seen under five minutes ago
 * - `idle`: in session, last seen five minutes ago or more
 * - `unverified`: no session, and the address is not confirmed
 * - `disabled`: cannot sign in (wins over everything else)
 * - `offline`: no session
 */
export type UserStatus = "active" | "idle" | "unverified" | "disabled" | "offline";

export function userStatus(user: { enabled: boolean; emailVerified: boolean }, idleSeconds: number | null): UserStatus {
	if (!user.enabled) return "disabled";
	if (idleSeconds !== null) return idleSeconds < IDLE_AFTER_SECONDS ? "active" : "idle";
	return user.emailVerified ? "offline" : "unverified";
}
