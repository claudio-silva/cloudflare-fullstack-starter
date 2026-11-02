import { Hono } from "hono";
import type { AppBindings } from "../types/context";
import { authMiddleware } from "../middleware/auth";
import { createDb } from "../db";
import { AppError } from "../lib/errors";
import { revokeSession, revokeSessions } from "../lib/users";
import { listUserSessions } from "../lib/user-sessions";
import type { UserSessionList } from "../../shared/sessions";

/**
 * The signed-in user's own sessions, one per device, mounted at
 * `/api/profile/sessions`: the "Where you're signed in" section of the profile
 * page. Better Auth has `list-sessions` and `revoke-session` too, but its list
 * hands every session's token to the browser and knows no country; these
 * answer `UserSession` (never the token), and log each ended session as
 * `session-revoked` like the rest. In a demo the writes are refused by
 * `demoMiddleware` (the accounts are shared) and the IPs are masked.
 */
export const sessions = new Hono<AppBindings>();

sessions.use("*", authMiddleware);

const currentSessionId = (c: { get: (key: "session") => unknown }) => (c.get("session") as { id?: string } | null | undefined)?.id ?? null;

function userId(c: { get: (key: "user") => { id: string } | null }): string {
	const user = c.get("user");
	if (!user?.id) throw new AppError(401, "Your session has expired. Please sign in again.", { code: "unauthenticated" });
	return user.id;
}

sessions.get("/", async (c) => {
	const list = await listUserSessions(createDb(c.env), c.env, userId(c), currentSessionId(c));
	return c.json<UserSessionList>({ sessions: list, total: list.length });
});

/** `POST /sign-out-others`: ends every session but this one. */
sessions.post("/sign-out-others", async (c) => {
	const ended = await revokeSessions(createDb(c.env), userId(c), null, currentSessionId(c));
	return c.json({ ended });
});

/** `DELETE /:id`: ends one of the user's other sessions (to end this one, sign out). */
sessions.delete("/:id", async (c) => {
	const id = c.req.param("id");
	if (id === currentSessionId(c)) {
		throw new AppError(400, "This is the device you are using now: sign out instead.", { code: "current_session", log: `session ${id} is the current one` });
	}
	if (!(await revokeSession(createDb(c.env), userId(c), id))) {
		throw new AppError(404, "That session has already ended.", { code: "session_not_found", log: `session ${id} is not one of user ${userId(c)}'s` });
	}
	return c.body(null, 204);
});
