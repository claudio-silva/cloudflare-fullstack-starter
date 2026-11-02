/**
 * One of a user's sessions, one per device, as the profile page, the admin
 * area and the auth CLI list them. Never carries the session's token: it is
 * the credential itself, and the id is enough to end the session.
 */
export type UserSession = {
	id: string;
	/** The browser and kind of device ("Chrome · Desktop"), from the user agent (`describeBrowser`). */
	device: string;
	userAgent: string | null;
	/** Masked in a demo, like everywhere else. */
	ip: string | null;
	/** ISO code, from the sign-in that opened the session; null when that sign-in left none (local, or logged before the log kept the session). */
	country: string | null;
	/** When the user signed in. */
	createdAt: string;
	/** Last used (`sessions.updatedAt`, touched about once a minute). */
	lastSeenAt: string;
	expiresAt: string;
	idleSeconds: number;
	/** `active` when used in the last five minutes, `idle` after that (`sessionStatus`). */
	status: "active" | "idle";
	/** The session that made the request. */
	current: boolean;
};

export type UserSessionList = { sessions: UserSession[]; total: number };
