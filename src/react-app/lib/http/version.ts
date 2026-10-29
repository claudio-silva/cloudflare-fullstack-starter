import { config } from "../../../config";
import { APP_VERSION } from "../../../shared/app-version";
import { isBreakingChange } from "../../../shared/http-contract";
import { browser } from "./browser";
import { createStore } from "./store";

/**
 * Keeping the open tab on the same version as the server.
 *
 * The bug this prevents is the classic client/server one: after a deploy, a
 * tab opened yesterday keeps running yesterday's code against today's API.
 * Every API response carries `X-App-Version`; the first one that differs from
 * the version this bundle was built with opens a dialog offering to reload.
 *
 *  - "Update now" reloads.
 *  - "Postpone" leaves a banner with an Update button, and turns on update-
 *    pending mode. The dialog does not come back: the user may be presenting,
 *    and a dialog that keeps returning is worse than a stale tab. Instead, the
 *    next client-side navigation becomes a full page load, which gets the new
 *    version at the one moment nothing typed on the page can be lost.
 *  - Postponing is not forever: `config.http.updateGraceMinutes` after it, the
 *    tab reloads by itself. The banner counts down, and in the last minute
 *    tells the user to save what they have not saved.
 *
 * Which of the two is decided by the version numbers (`isBreakingChange`): a
 * new major — or, before 1.0.0, a new minor — is a release whose API this tab
 * cannot be trusted with, and so is a rollback across one. Then there is no
 * postponing (`requireUpdate()`): the dialog shows without "Postpone", and the
 * server refuses the tab's API requests with a 426 (`code:
 * "client_incompatible"`), which leads here too if no response said so first.
 *
 * Idle tabs make no requests, so returning to a tab that has been in the
 * background for a while asks the server once (`checkOnReturn`).
 *
 * A comparison by equality, not by order: a rollback is a version change too,
 * and the tab should follow it.
 */

/**
 * `available`: a new version, not yet answered. `pending`: postponed, until
 * `deadline` (epoch ms). `required`: a version this one cannot work with.
 */
export type UpdateStatus = "current" | "available" | "pending" | "required";
export type UpdateState = { status: UpdateStatus; serverVersion: string | null; deadline: number | null };

const INITIAL: UpdateState = { status: "current", serverVersion: null, deadline: null };

export const updateStore = createStore<UpdateState>(INITIAL);

/** The version this bundle was built with. */
export const CLIENT_VERSION = APP_VERSION;

let lastSeenAt = Date.now();

/** Called with the header of every API response. */
export function noteServerVersion(version: string | null): void {
	lastSeenAt = Date.now();
	if (!version || version === CLIENT_VERSION) return;
	// A breaking release overrides a postponed one: there is no waiting it out.
	if (isBreakingChange(CLIENT_VERSION, version)) return requireUpdate(version);
	if (updateStore.get().status !== "current") return;
	updateStore.set({ status: "available", serverVersion: version, deadline: null });
}

/** The server's version is incompatible with this one: only updating is left. */
export function requireUpdate(serverVersion: string | null = null): void {
	const current = updateStore.get();
	if (current.status === "required") return;
	clearTimeout(graceTimer);
	updateStore.set({ status: "required", serverVersion: serverVersion ?? current.serverVersion, deadline: null });
}

export function isUpdatePending(): boolean {
	return updateStore.get().status === "pending";
}

export function updateNow(): void {
	browser.location?.reload();
}

let graceTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * "Postpone": no more dialogs. The banner counts down to an automatic update,
 * and the next navigation loads the new version sooner.
 */
export function postponeUpdate(graceMinutes: number = config.http.updateGraceMinutes): void {
	const { status, serverVersion } = updateStore.get();
	if (status === "required" || status === "pending") return;
	const graceMs = Math.max(0, graceMinutes) * 60_000;
	updateStore.set({ status: "pending", serverVersion, deadline: Date.now() + graceMs });
	guardNavigation();
	// A timer in a background tab may fire late, never early: the reload
	// happens at the deadline or as soon after it as the browser allows.
	graceTimer = setTimeout(updateNow, graceMs);
}

let guarded = false;

/**
 * In update-pending mode, a client-side navigation becomes a real one.
 *
 * Done at the History API, below any router, so every way of navigating is
 * covered — links, `navigate()`, redirects — and the old code never renders
 * the next page. Only path changes count for `replaceState`: routers and
 * libraries also use it to sync query state on the same page, and reloading
 * for that would be the interruption this mode exists to avoid.
 */
function guardNavigation(): void {
	const { history, location } = browser;
	if (guarded || !history || !location) return;
	guarded = true;

	const leaves = (url: string | URL | null | undefined, includeSearch: boolean): URL | null => {
		if (url == null) return null;
		const target = new URL(url, location.href);
		if (target.origin !== location.origin) return null;
		const changed = target.pathname !== location.pathname || (includeSearch && target.search !== location.search);
		return changed ? target : null;
	};

	const push = history.pushState.bind(history);
	const replace = history.replaceState.bind(history);
	history.pushState = (data, unused, url) => {
		const target = leaves(url, true);
		if (target) return location.assign(target.href);
		push(data, unused, url);
	};
	history.replaceState = (data, unused, url) => {
		const target = leaves(url, false);
		if (target) return location.replace(target.href);
		replace(data, unused, url);
	};

	// Back and forward have already changed the URL by the time we hear of
	// them: load whatever it now says.
	let path = location.pathname + location.search;
	browser.addEventListener?.("popstate", () => {
		if (location.pathname + location.search !== path) location.reload();
		path = location.pathname + location.search;
	});
}

/**
 * Ask the server for its version when a tab comes back after a while, since
 * a tab that sits in the background makes no requests to learn it from.
 */
export function checkOnReturn(ask: () => Promise<unknown>, afterMs = 10 * 60_000): () => void {
	const { document } = browser;
	if (!document) return () => undefined;
	const onVisible = () => {
		if (document.visibilityState === "visible" && Date.now() - lastSeenAt > afterMs) {
			lastSeenAt = Date.now();
			void ask().catch(() => undefined);
		}
	};
	document.addEventListener("visibilitychange", onVisible);
	return () => document.removeEventListener("visibilitychange", onVisible);
}

/**
 * A lazily loaded chunk that no longer exists means the server has been
 * redeployed under us: the old hashed files are gone. Vite reports it as
 * `vite:preloadError`. Reloading loads the new version — once, so a chunk
 * that is broken for another reason cannot loop.
 */
export function reloadOnStaleChunks(onStale?: (error: unknown) => void): void {
	const { location, sessionStorage } = browser;
	if (!location || !sessionStorage) return;
	browser.addEventListener?.("vite:preloadError", (event) => {
		onStale?.((event as Event & { payload?: unknown }).payload);
		const key = "app:chunk-reload";
		const last = Number(sessionStorage.getItem(key) ?? 0);
		if (Date.now() - last < 30_000) return;
		sessionStorage.setItem(key, String(Date.now()));
		event.preventDefault();
		location.reload();
	});
}

/** For tests. */
export function resetVersionState(): void {
	clearTimeout(graceTimer);
	updateStore.set(INITIAL);
	lastSeenAt = Date.now();
}
