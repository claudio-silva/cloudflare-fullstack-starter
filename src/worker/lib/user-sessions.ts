import type { Kysely } from "kysely";
import type { Database } from "../types/database";
import type { AppEnv } from "../types/env";
import { dbBool, dbNow, toIso } from "../db";
import { demoIp } from "../middleware/demo";
import { describeBrowser } from "../../shared/browser";
import { sessionStatus } from "../../shared/user-status";
import type { UserSession } from "../../shared/sessions";

type Db = Kysely<Database>;

/**
 * The user's live sessions, one per device, most recently used first: what the
 * profile page, the admin user page and the auth CLI list.
 *
 * `sessions` keeps no country, so it comes from the sign-in that opened each
 * session (`login_events.session_id`); a session with no such row (opened
 * before the log kept the session, or where Cloudflare gives no country, as in
 * local development) has none. The token is never selected.
 * `currentId` marks the session making the request.
 */
export async function listUserSessions(db: Db, env: Pick<AppEnv, "DEMO_MODE">, userId: string, currentId?: string | null): Promise<UserSession[]> {
	const sessions = await db
		.selectFrom("sessions")
		.select(["id", "ipAddress", "userAgent", "createdAt", "updatedAt", "expiresAt"])
		.where("userId", "=", userId)
		.where("expiresAt", ">", dbNow())
		.orderBy("updatedAt", "desc")
		.orderBy("id")
		.execute();
	if (sessions.length === 0) return [];

	// D1 binds at most 100 parameters per query; a user with this many sessions is not expected, but is not an error.
	const countries = new Map<string, string | null>();
	for (let i = 0; i < sessions.length; i += 50) {
		const rows = await db
			.selectFrom("login_events")
			.select(["session_id", "country"])
			.where("user_id", "=", userId)
			.where("session_id", "in", sessions.slice(i, i + 50).map((s) => s.id))
			.where("success", "=", dbBool(true))
			.where((eb) => eb.or([eb("event", "is", null), eb("event", "=", "sign-in")]))
			.execute();
		for (const r of rows) if (r.session_id) countries.set(r.session_id, r.country);
	}

	const now = Date.now();
	return sessions.map((s) => {
		const idleSeconds = Math.max(0, Math.round((now - new Date(s.updatedAt).getTime()) / 1000));
		return {
			id: s.id,
			device: describeBrowser(s.userAgent),
			userAgent: s.userAgent,
			ip: demoIp(env, s.ipAddress),
			country: countries.get(s.id) ?? null,
			createdAt: toIso(s.createdAt) ?? "",
			lastSeenAt: toIso(s.updatedAt) ?? "",
			expiresAt: toIso(s.expiresAt) ?? "",
			idleSeconds,
			status: sessionStatus(idleSeconds),
			current: s.id === currentId,
		};
	});
}
