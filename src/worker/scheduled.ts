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

export async function scheduled(event: ScheduledController, env: AppEnv): Promise<void> {
	// The sign-in log is a permanent history unless AUTH_LOG_RETENTION_DAYS is set;
	// the totals in user_stats are kept either way (lib/login-log.ts).
	const days = Number(env.AUTH_LOG_RETENTION_DAYS);
	if (Number.isFinite(days) && days > 0) {
		try {
			const deleted = await pruneLoginEvents(env, days);
			if (deleted > 0) console.log(`[cron ${event.cron}] pruned ${deleted} login_events older than ${days} days`);
		} catch (error) {
			console.error(`[cron ${event.cron}] pruning login_events failed`, error);
		}
	}
	try {
		const deleted = await pruneExpiredAuthRows(env);
		if (deleted > 0) console.log(`[cron ${event.cron}] pruned ${deleted} expired sessions and verifications`);
	} catch (error) {
		console.error(`[cron ${event.cron}] pruning expired sessions failed`, error);
	}
}
