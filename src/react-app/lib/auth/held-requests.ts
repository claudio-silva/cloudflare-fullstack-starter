import { browser } from "../http/browser";
import { t } from "../i18n";

/**
 * Requests held for the re-login (see `withSessionEndedGuard`). They live only
 * in memory, so leaving the page loses them: a `beforeunload` prompt guards
 * reloads and tab closes while any write is held, and `confirmDiscardHeldRequests`
 * guards our own navigations ("Use another account", the forgot-password link).
 */
export interface HeldSummary {
	/** Held requests that are not GET or HEAD. */
	writes: number;
}

let held: HeldSummary = { writes: 0 };

/** Set once the page is being left on purpose: no native `beforeunload` prompt may ask again. */
let unloadGuardSuspended = false;

const onBeforeUnload = (event: Event) => {
	if (unloadGuardSuspended) return;
	event.preventDefault();
	// Legacy browsers need a value; modern ones show their own generic text.
	(event as unknown as { returnValue: string }).returnValue = "";
};

/**
 * Fed by the session-ended guard. Held reads (polling GETs) are not counted:
 * nothing would be lost by leaving, so only writes arm the unload guard and the
 * discard confirm.
 */
export function setHeldRequests(next: HeldSummary): void {
	const before = held.writes > 0;
	held = { writes: Math.max(0, next.writes) };
	const after = held.writes > 0;
	if (before === after) return;
	if (after) browser.addEventListener?.("beforeunload", onBeforeUnload);
	else browser.removeEventListener?.("beforeunload", onBeforeUnload);
}

/**
 * The page is being left on purpose (the user accepted the discard confirm, or
 * a forced expulsion such as another account signing in): every `beforeunload`
 * guard stands down. Held requests are not rejected: the navigation drops them,
 * and rejecting would only run their error paths (toasts, rollbacks) on the way out.
 */
export function standDownUnloadGuards(): void {
	unloadGuardSuspended = true;
}

/** The page stayed alive (restored from the back/forward cache): the guards are back. */
export function resumeUnloadGuards(): void {
	unloadGuardSuspended = false;
}

export function isUnloadGuardSuspended(): boolean {
	return unloadGuardSuspended;
}

/** True while at least one held request is a write. */
export function hasHeldRequests(): boolean {
	return held.writes > 0;
}

/** True when it is fine to leave: nothing would be lost, or the user accepted losing it. */
export function confirmDiscardHeldRequests(
	confirmFn: (message: string) => boolean = (message) => (globalThis as { confirm?: (m: string) => boolean }).confirm?.(message) ?? true,
): boolean {
	if (!hasHeldRequests()) return true;
	return confirmFn(t("session.discardHeld"));
}
