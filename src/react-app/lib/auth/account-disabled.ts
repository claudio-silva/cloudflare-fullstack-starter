import { ACCOUNT_DISABLED_STATUS, isAccountDisabledBody } from "../../../shared/account-status";
import { browser } from "../http/browser";
import { resumeUnloadGuards, standDownUnloadGuards } from "./held-requests";
import { getSessionEnded, requestUrl } from "./session-ended";

/** The public page a disabled account is sent to. */
export const ACCOUNT_DISABLED_PATH = "/account-disabled";

/**
 * Same-origin `/api/` answers 403 `account_disabled` for every request of a
 * disabled account, Better Auth's included. The page is left for the public
 * "account disabled" page: `onDisabled` navigates, and the promise returned to
 * the caller never settles, so no caller shows a toast or an error (and no
 * session-ended dialog) while the page goes away. On the page itself the
 * response is returned unchanged, so it cannot loop.
 */
export function withAccountDisabledGuard(fetchImpl: typeof fetch, onDisabled: () => void, origin: string): typeof fetch {
	return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const response = await fetchImpl(input, init);
		if (response.status !== ACCOUNT_DISABLED_STATUS) return response;
		try {
			const url = new URL(requestUrl(input), origin);
			if (url.origin !== new URL(origin).origin || !url.pathname.startsWith("/api/")) return response;
			if (!isAccountDisabledBody(await response.clone().json())) return response;
		} catch {
			// Not JSON, a bad URL or an unreadable body: nothing to learn.
			return response;
		}
		if (browser.location?.pathname === ACCOUNT_DISABLED_PATH) return response;
		onDisabled();
		return new Promise<Response>(() => undefined);
	};
}

let expelled = false;

/**
 * One-shot: stand the unload guards down (no native "leave this page?" prompt
 * may block a forced expulsion), freeze the session-ended logic so nothing held
 * is replayed, then replace the location. Held requests are dropped with the
 * page. Should the page come back from the back/forward cache, the guards and
 * the restore logic are back.
 */
export function expelToAccountDisabledPage(): void {
	if (expelled || browser.location?.pathname === ACCOUNT_DISABLED_PATH) return;
	expelled = true;
	standDownUnloadGuards();
	getSessionEnded().leave();
	browser.addEventListener?.(
		"pageshow",
		(event) => {
			if (!(event as unknown as { persisted?: boolean }).persisted) return;
			expelled = false;
			resumeUnloadGuards();
			getSessionEnded().resume();
		},
		{ once: true },
	);
	browser.location?.replace(ACCOUNT_DISABLED_PATH);
}
