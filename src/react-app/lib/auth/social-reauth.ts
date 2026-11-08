import { REAUTH_ACCOUNT_DISABLED_ERROR, REAUTH_COMPLETE_PATH } from "../../../shared/account-status";
import { confirmAndDiscardForNavigation } from "../../components/auth/leave-session";
import { resumeUnloadGuards } from "./held-requests";
import { isKnownSocialProvider } from "./reauth-methods";
import { getSessionEnded } from "./session-ended";

/** The channel the completion page (`/auth/reauth-complete`) reports on. Not `window.opener`: Google's COOP severs it. */
export const REAUTH_CHANNEL = "auth-reauth";
export { REAUTH_ACCOUNT_DISABLED_ERROR, REAUTH_COMPLETE_PATH };
export const REAUTH_POPUP_FEATURES = "popup,width=500,height=640";
/** The popup was abandoned without a word (closed behind our back, or the user walked away). */
export const REAUTH_TIMEOUT_MS = 10 * 60 * 1000;
/** A completion that did not restore the session in this long leaves the button usable again. */
export const REAUTH_SETTLE_MS = 8000;

/** `reason: "account_disabled"` accompanies `ok: false` when the server refused the sign-in because the account is disabled. */
export type ReauthMessage = { type: "reauth-complete"; ok: boolean; reason?: typeof REAUTH_ACCOUNT_DISABLED_ERROR };

export type SocialReauthState = "busy" | "idle" | "failed";

type PopupLike = { location: { href: string }; closed?: boolean; close(): void };
type ChannelLike = { onmessage: ((event: MessageEvent) => unknown) | null; close(): void };

export type SocialReauthDeps = {
	openWindow: (url: string, name: string, features: string) => PopupLike | null;
	signInSocial: (args: { provider: string; callbackURL: string; errorCallbackURL?: string; disableRedirect?: boolean }) => Promise<{ data?: { url?: string } | null; error?: unknown }>;
	channel: () => ChannelLike;
	/** True when it is fine to leave this page (held writes confirmed lost); stands the unload guards down. */
	confirm: () => boolean;
	/** Undoes `confirm` when the redirect could not even start. */
	resume: () => void;
	location: { href: string };
	refetchSession: () => void;
	/** The opener window got focus: the user may have closed the popup. */
	onFocus: (listener: () => void) => () => void;
	setTimeout: (fn: () => void, ms: number) => unknown;
	clearTimeout: (handle: unknown) => void;
	onState: (state: SocialReauthState) => void;
	/** The popup reported the account is disabled: leave for the account-disabled page. */
	onDisabled: () => void;
};

/** The real page, for `confirm` and `resume`: the same pair every navigation that discards state uses. */
export const pageNavigationDeps = {
	confirm: (): boolean => confirmAndDiscardForNavigation(),
	resume: (): void => {
		resumeUnloadGuards();
		getSessionEnded().resume();
	},
};

export type SocialReauthOutcome = "redirecting" | "declined" | "popup" | "failed";

/**
 * Re-authenticates with a social provider without losing the page.
 *
 * The popup is opened synchronously, in the click handler's own turn: after any `await` a browser
 * treats it as unrequested and blocks it. Blocked: the only way left is a full redirect, which drops
 * the page and everything held on it, so it is confirmed first. The completion comes back over a
 * BroadcastChannel from `/auth/reauth-complete`, and a session refetch lets the existing machinery
 * (`sessionSeen`) restore the same user or leave for a different one.
 *
 * The button is never left busy for good: a failure, a focus back on the opener, a timeout and a
 * completion that does not restore the session all return it to idle (or failed).
 */
export async function startSocialReauth(provider: string, deps: SocialReauthDeps): Promise<SocialReauthOutcome> {
	const opened = deps.openWindow("about:blank", REAUTH_CHANNEL, REAUTH_POPUP_FEATURES);
	// A blocker extension can hand back a window that is already closed. Checked now, before the URL
	// is assigned (COOP only severs the handle once the provider's page loads), it counts as blocked.
	const popup = opened !== null && opened.closed !== true ? opened : null;

	if (popup === null) {
		if (!deps.confirm()) return "declined";
		deps.onState("busy");
		try {
			const { error } = await deps.signInSocial({ provider, callbackURL: deps.location.href, errorCallbackURL: reauthErrorCallbackURL(deps.location.href, provider) });
			if (error) throw error;
		} catch {
			// Never leave the page frozen behind a redirect that did not happen.
			deps.resume();
			deps.onState("failed");
			return "failed";
		}
		return "redirecting";
	}

	const channel = deps.channel();
	// Armed first so `finish` can read it; the callback only runs later, after `finish` exists.
	const timer = deps.setTimeout(() => finish("idle"), REAUTH_TIMEOUT_MS);
	let settle: unknown;
	let stopFocus: () => void = () => undefined;
	let done = false;
	const finish = (state: SocialReauthState | null): void => {
		if (done) return;
		done = true;
		channel.onmessage = null;
		channel.close();
		stopFocus();
		deps.clearTimeout(timer);
		deps.clearTimeout(settle);
		if (state) deps.onState(state);
	};
	deps.onState("busy");

	channel.onmessage = (event) => {
		const message = event.data as Partial<ReauthMessage> | null;
		if (message?.type !== "reauth-complete") return;
		if (message.ok === false && message.reason === REAUTH_ACCOUNT_DISABLED_ERROR) {
			finish(null);
			deps.onDisabled();
		} else if (message.ok === true) {
			deps.refetchSession();
			// The dialog unmounts when the session is restored; if it did not, the user can try again.
			finish(null);
			settle = deps.setTimeout(() => deps.onState("idle"), REAUTH_SETTLE_MS);
		} else {
			finish("failed");
		}
	};
	// The user may have closed the popup: they come back to this window. The channel stays open, so a
	// completion that is still on its way is not lost.
	stopFocus = deps.onFocus(() => deps.onState("idle"));

	let url: string | undefined;
	try {
		const { data, error } = await deps.signInSocial({
			provider,
			callbackURL: REAUTH_COMPLETE_PATH,
			errorCallbackURL: `${REAUTH_COMPLETE_PATH}?error=1`,
			disableRedirect: true,
		});
		url = error ? undefined : (data?.url ?? undefined);
	} catch {
		url = undefined;
	}
	if (!url) {
		popup.close();
		finish("failed");
		return "failed";
	}
	popup.location.href = url;
	return "popup";
}

/** Our marker on the redirect fallback's `errorCallbackURL`, valued with the provider id: only an error that comes with it is ours. */
export const REAUTH_ERROR_MARKER = "reauth_error";

/** The redirect fallback's `errorCallbackURL`: the current page, marked as a re-login attempt with `provider`. */
export function reauthErrorCallbackURL(href: string, provider: string): string {
	const url = new URL(href);
	url.searchParams.set(REAUTH_ERROR_MARKER, provider);
	return url.toString();
}

/**
 * The redirect fallback returns to the page with `?reauth_error=<provider>&error=<code>` when the
 * provider refused. Pure: says whether that happened (and for which provider) and what the URL is
 * without the parameters we and Better Auth added, so the message shows once and a reload does not
 * repeat it. A failure needs our marker, an `error` beside it and a provider id the app knows: the
 * marker alone, or any other value, is stripped and says nothing (the URL is attacker-writable, and
 * the id ends up in a toast). An `error` without our marker belongs to the page and is left alone.
 */
export function takeReauthError(href: string): { failed: boolean; provider: string | null; cleanHref: string } {
	const url = new URL(href);
	const marker = url.searchParams.get(REAUTH_ERROR_MARKER);
	if (marker === null) return { failed: false, provider: null, cleanHref: href };
	const failed = url.searchParams.has("error") && isKnownSocialProvider(marker);
	url.searchParams.delete(REAUTH_ERROR_MARKER);
	url.searchParams.delete("error");
	url.searchParams.delete("error_description");
	return { failed, provider: failed ? marker : null, cleanHref: `${url.pathname}${url.search}${url.hash}` };
}
