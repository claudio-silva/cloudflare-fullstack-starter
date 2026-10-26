import type { AppEnv } from "./types/env";
import { pruneLoginEvents } from "./lib/login-log";
import { pruneExpiredAuthRows } from "./lib/expired-auth-rows";

/**
 * Cron handler. Wire new jobs in here rather than adding another trigger:
 * `wrangler.toml` schedules the Worker, and this picks the work by cron string.
 *
 * Keep each job independently failing — one job throwing should not stop the
 * rest — and keep them idempotent, since a cron can fire twice.
 */

/** Days of sign-in history to keep. `ip` is personal data, so this has an upper bound by design. */
const DEFAULT_RETENTION_DAYS = 90;

export async function scheduled(event: ScheduledController, env: AppEnv): Promise<void> {
	const days = Number(env.AUTH_LOG_RETENTION_DAYS ?? DEFAULT_RETENTION_DAYS);
	try {
		const deleted = await pruneLoginEvents(env, Number.isFinite(days) && days > 0 ? days : DEFAULT_RETENTION_DAYS);
		if (deleted > 0) console.log(`[cron ${event.cron}] pruned ${deleted} login_events older than ${days} days`);
	} catch (error) {
		console.error(`[cron ${event.cron}] pruning login_events failed`, error);
	}
	try {
		const deleted = await pruneExpiredAuthRows(env);
		if (deleted > 0) console.log(`[cron ${event.cron}] pruned ${deleted} expired sessions and verifications`);
	} catch (error) {
		console.error(`[cron ${event.cron}] pruning expired sessions failed`, error);
	}
}
