import { z } from "zod";
import { ROLES, type Role } from "./roles";

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
	/** Shown as "active": an unverified user cannot sign in while verification is required. */
	emailVerified: z.boolean(),
});

export const createUserSchema = userFields.extend({ password });

/** Every field optional; `password` sets a new one and signs the user out everywhere. */
export const updateUserSchema = userFields.partial().extend({ password: password.optional() });

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

/** A session untouched for this long makes its user idle rather than active. */
export const IDLE_AFTER_SECONDS = 5 * 60;

/**
 * - `active`: in session, last seen under five minutes ago
 * - `idle`: in session, last seen five minutes ago or more
 * - `disabled`: cannot sign in
 * - `offline`: has no session
 */
export type UserStatus = "active" | "idle" | "disabled" | "offline";

export function userStatus(emailVerified: boolean, idleSeconds: number | null): UserStatus {
	if (!emailVerified) return "disabled";
	if (idleSeconds === null) return "offline";
	return idleSeconds < IDLE_AFTER_SECONDS ? "active" : "idle";
}

export type AdminUser = {
	id: string;
	name: string | null;
	email: string;
	role: Role | string;
	emailVerified: boolean;
	status: UserStatus;
	/** Seconds since the user's most recent session was last used; null when they have none. */
	idleSeconds: number | null;
	/** The most recent successful sign-in in `login_events`; null when none is recorded. */
	lastSignInAt: string | null;
	createdAt: string;
	updatedAt: string;
};

export type AdminUserDetail = AdminUser & {
	/** Better Auth provider ids: "credential" (password), "google", … */
	signInMethods: string[];
	activeSessions: number;
	lastSignOutAt: string | null;
	/** Where the most recently used session comes from; null when the user is not in session. */
	currentSession: { ip: string | null; country: string | null } | null;
	/** Entries in the activity log (the Activity tab's pill). */
	activityCount: number;
};

export type ActivityEvent = {
	id: string;
	/** `failed` is a sign-in attempt that did not succeed. */
	kind: "sign-in" | "sign-out" | "failed" | "session-expired" | "session-revoked";
	ip: string | null;
	country: string | null;
	userAgent: string | null;
	createdAt: string;
};

export const ACTIVITY_SORT_FIELDS = ["createdAt", "kind", "ip", "country", "browser"] as const;
export type ActivitySortField = (typeof ACTIVITY_SORT_FIELDS)[number];

export type AdminUserActivity = { events: ActivityEvent[]; total: number; page: number; pageSize: number };

export const USER_SORT_FIELDS = ["name", "email", "role", "status", "lastSignInAt", "idleSeconds", "createdAt"] as const;
export type UserSortField = (typeof USER_SORT_FIELDS)[number];

export type AdminUserList = {
	users: AdminUser[];
	total: number;
	page: number;
	pageSize: number;
};

/**
 * "Chrome · Desktop" from a User-Agent string: the browser's name and whether
 * it is a phone, a tablet or a computer. Good enough to recognise a sign-in,
 * not a fingerprint: an iPad in desktop mode says it is a Mac, and anything the
 * list below does not know falls back to the raw string. Order matters, as most
 * browsers also claim to be Chrome and Safari.
 */
export function describeBrowser(userAgent: string | null): string {
	if (!userAgent) return "—";
	const ua = userAgent;
	const names: [RegExp, string][] = [
		[/Edg(e|A|iOS)?\//, "Edge"],
		[/OPR\/|Opera/, "Opera"],
		[/SamsungBrowser/, "Samsung Internet"],
		[/Firefox\/|FxiOS/, "Firefox"],
		[/Chrome\/|CriOS/, "Chrome"],
		[/Safari\//, "Safari"],
	];
	const name = names.find(([pattern]) => pattern.test(ua))?.[1];
	if (!name) return ua.length > 40 ? `${ua.slice(0, 40)}…` : ua; // curl, bots, apps
	const device = /iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua)) ? "Tablet" : /Mobi|iPhone|iPod|Android/i.test(ua) ? "Mobile" : "Desktop";
	return `${name} · ${device}`;
}
