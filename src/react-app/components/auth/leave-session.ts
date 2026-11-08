import { getSessionEnded } from "../../lib/auth/session-ended";
import { confirmDiscardHeldRequests, resumeUnloadGuards, standDownUnloadGuards } from "../../lib/auth/held-requests";
import { browser } from "../../lib/http/browser";

/** A sign-out that stalls (network, a held connection) must not trap the user on the page. */
export const SIGN_OUT_TIMEOUT_MS = 4000;

/**
 * Leaving the page from the session-ended dialog ("Use another account", the
 * forgot-password link): one app confirm if writes are held, then every
 * `beforeunload` guard stands down so the browser does not ask again. Coming
 * back from the back/forward cache (`pageshow` with `persisted`) resumes them.
 *
 * Held requests are deliberately NOT rejected (that would run every caller's
 * error path: toasts, rollbacks). They stay pending; the full-page navigation
 * that follows drops them with the page, and nothing is replayed under another login.
 */
export function confirmAndDiscardForNavigation(
	confirmFn?: (message: string) => boolean,
	target: Pick<Required<typeof browser>, "addEventListener"> | null = browser.addEventListener ? (browser as Required<typeof browser>) : null,
): boolean {
	if (!confirmDiscardHeldRequests(confirmFn)) return false;
	standDownUnloadGuards();
	getSessionEnded().leave();
	target?.addEventListener("pageshow", (event) => {
		if (!(event as PageTransitionEvent).persisted) return;
		resumeUnloadGuards();
		getSessionEnded().resume();
	});
	return true;
}

/**
 * "Use another account": confirm, sign out (bounded by `timeoutMs`; a failure or
 * a stall still leaves), then navigate. Never rejects held requests.
 */
export async function switchAccount(deps: {
	signOut: () => Promise<unknown>;
	navigate: () => void;
	onLeaving?: () => void;
	confirmFn?: (message: string) => boolean;
	target?: Pick<Required<typeof browser>, "addEventListener"> | null;
	timeoutMs?: number;
}): Promise<boolean> {
	if (!confirmAndDiscardForNavigation(deps.confirmFn, deps.target)) return false;
	deps.onLeaving?.();
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			deps.signOut(),
			new Promise<void>((resolve) => {
				timer = setTimeout(resolve, deps.timeoutMs ?? SIGN_OUT_TIMEOUT_MS);
			}),
		]);
	} catch {
		// Nothing to do: we leave anyway.
	} finally {
		clearTimeout(timer);
	}
	deps.navigate();
	return true;
}
