import { z } from "zod";
import { ROLES, type Role } from "./roles";
import type { UserStatus } from "./user-status";

/**
 * The contract of the example admin area's user management
 * (`/api/admin/users`): what the Worker validates and the form checks before
 * sending. Part of the removable admin example; see docs/ADMIN.md.
 */

const email = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address."));
const password = z.string().min(8, "At least 8 characters.").max(128, "At most 128 characters.");

const userFields = z.object({
	name: z.string().trim().max(100, "At most 100 characters."),
	email,
	role: z.enum(ROLES),
	/** A disabled user cannot sign in, whatever else is true. */
	enabled: z.boolean(),
	/** The address is confirmed (by the emailed link, by Google, or by an admin). Unverified users cannot sign in while verification is required. */
	emailVerified: z.boolean(),
});

export const createUserSchema = userFields.extend({ password });

/** Every field optional; `password` sets a new one and signs the user out everywhere. */
export const updateUserSchema = userFields.partial().extend({ password: password.optional() });

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export { IDLE_AFTER_SECONDS, userStatus, type UserStatus } from "./user-status";

export type AdminUser = {
	id: string;
	name: string | null;
	email: string;
	role: Role | string;
	/** The profile picture an OAuth provider gave, if any. */
	image: string | null;
	enabled: boolean;
	emailVerified: boolean;
	status: UserStatus;
	/** Seconds since the user's most recent session was last used; null when they have none. */
	idleSeconds: number | null;
	/** The most recent successful sign-in (`user_stats`); null when none is recorded. */
	lastSignInAt: string | null;
	/** Time in session: every ended session (`user_stats`) plus the open ones so far. */
	usageSeconds: number;
	createdAt: string;
	updatedAt: string;
};

export type AdminUserDetail = AdminUser & {
	/** Better Auth provider ids: "credential" (password), "google", … */
	signInMethods: string[];
	activeSessions: number;
	lastSignOutAt: string | null;
	signIns: number;
	failedSignIns: number;
	/** Where the most recently used session comes from; null when the user is not in session. */
	currentSession: { ip: string | null; country: string | null } | null;
	/** Entries in the activity log (the Activity tab's pill). */
	activityCount: number;
};

export type ActivityEvent = {
	id: string;
	/** `failed` is a sign-in attempt that did not succeed. */
	kind: "sign-in" | "sign-out" | "failed" | "session-expired" | "session-revoked";
	/** How a sign-in authenticated: "password", "google", … */
	method: string | null;
	/** Who revoked the session, when it was not the user; null if that account is gone. */
	actor: string | null;
	/** On a session's last event: how long it lasted. */
	durationSeconds: number | null;
	ip: string | null;
	country: string | null;
	userAgent: string | null;
	createdAt: string;
};

export const ACTIVITY_SORT_FIELDS = ["createdAt", "kind", "ip", "country", "browser"] as const;
export type ActivitySortField = (typeof ACTIVITY_SORT_FIELDS)[number];

export type AdminUserActivity = { events: ActivityEvent[]; total: number; page: number; pageSize: number };

export const USER_SORT_FIELDS = ["name", "email", "role", "status", "lastSignInAt", "idleSeconds", "usageSeconds", "createdAt"] as const;
export type UserSortField = (typeof USER_SORT_FIELDS)[number];

export type AdminUserList = {
	users: AdminUser[];
	total: number;
	page: number;
	pageSize: number;
};

export { describeBrowser } from "./browser";
