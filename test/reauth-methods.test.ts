import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isUnloadGuardSuspended, resumeUnloadGuards, setHeldRequests } from "../src/react-app/lib/auth/held-requests";
import {
	REAUTH_METHODS_KEY,
	offeredSocialProviders,
	readStoredMethods,
	registerReauthMethod,
	registeredReauthIds,
	rememberSignInMethods,
	resetReauthMethods,
	resetLearning,
	registeredOfferRules,
	resolveReauthMethods,
	socialProviderName,
} from "../src/react-app/lib/auth/reauth-methods";
import { REAUTH_COMPLETE_PATH, pageNavigationDeps, reauthErrorCallbackURL, startSocialReauth, reauthUrlNeedsCleanup, takeReauthError, type SocialReauthDeps, type SocialReauthState } from "../src/react-app/lib/auth/social-reauth";
import { createSessionEnded, REMEMBERED_EMAIL_KEY } from "../src/react-app/lib/auth/session-ended";

/**
 * The re-login dialog follows the account's sign-in method. What has to hold: a password is never
 * asked of an account that has none; the popup is opened in the click's own turn; leaving the page
 * is confirmed first; a completion is never ignored; and no way the popup can fail leaves the user stuck.
 */

describe("resolveReauthMethods", () => {
	const stored = (providers: string[], email = "a@x") => ({ email, providers });

	it("credential only: the password, no social", () => {
		expect(resolveReauthMethods(stored(["credential"]), "a@x", ["google"], [])).toEqual({ password: true, social: [], registered: [] });
	});
	it("google only and offered: no password, the button", () => {
		expect(resolveReauthMethods(stored(["google"]), "a@x", ["google"], [])).toEqual({ password: false, social: ["google"], registered: [] });
	});
	it("google only and not offered here: nothing (only 'Use another account' remains)", () => {
		expect(resolveReauthMethods(stored(["google"]), "a@x", [], [])).toEqual({ password: false, social: [], registered: [] });
	});
	it("both: the password and the button, in the offered order", () => {
		expect(resolveReauthMethods(stored(["google", "credential"]), "a@x", ["github", "google"], [])).toEqual({ password: true, social: ["google"], registered: [] });
	});
	it("unknown (nothing stored): the password and every offered social, no registered method", () => {
		expect(resolveReauthMethods(null, "a@x", ["google"], ["magic-link"])).toEqual({ password: true, social: ["google"], registered: [] });
	});
	it("stored for another email is unknown", () => {
		expect(resolveReauthMethods(stored(["google"], "b@x"), "a@x", ["google"], [])).toEqual({ password: true, social: ["google"], registered: [] });
	});
	it("a registered id the account has is offered; one it does not have is not", () => {
		expect(resolveReauthMethods(stored(["magic-link"]), "a@x", ["google"], ["magic-link", "passkey"])).toEqual({ password: false, social: [], registered: ["magic-link"] });
		expect(resolveReauthMethods(stored(["credential"]), "a@x", [], ["magic-link"])).toEqual({ password: true, social: [], registered: [] });
	});
});

describe("offered providers and names", () => {
	it("google only when the deployment offers it", () => {
		expect(offeredSocialProviders({ google: true })).toEqual(["google"]);
		expect(offeredSocialProviders({ google: false })).toEqual([]);
	});
	it("known display names, otherwise the id capitalised", () => {
		expect(socialProviderName("google")).toBe("Google");
		expect(socialProviderName("github")).toBe("Github");
	});
});

function memoryStorage() {
	const map = new Map<string, string>();
	return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
}

describe("learning the methods", () => {
	beforeEach(() => resetLearning());

	it("stores the distinct provider ids with the email, once per tab load", async () => {
		const storage = memoryStorage();
		let calls = 0;
		const deps = { storage, listProviders: async () => (calls++, ["credential", "google", "google"]) };
		await rememberSignInMethods("a@x", deps);
		await rememberSignInMethods("a@x", deps);
		expect(calls).toBe(1);
		expect(readStoredMethods(storage)).toEqual({ email: "a@x", providers: ["credential", "google"] });
	});

	it("a failure stores nothing and the next attempt tries again", async () => {
		const storage = memoryStorage();
		await rememberSignInMethods("a@x", { storage, listProviders: async () => null });
		await rememberSignInMethods("a@x", { storage, listProviders: async () => { throw new Error("offline"); } });
		expect(storage.map.size).toBe(0);
		await rememberSignInMethods("a@x", { storage, listProviders: async () => ["credential"] });
		expect(readStoredMethods(storage)).toEqual({ email: "a@x", providers: ["credential"] });
	});

	it("an answer that arrives after a sign-out is dropped", async () => {
		const storage = memoryStorage();
		let release!: (v: string[]) => void;
		const pending = rememberSignInMethods("a@x", { storage, listProviders: () => new Promise((r) => (release = r)) });
		resetLearning(); // signingOut
		release(["google"]);
		await pending;
		expect(storage.map.size).toBe(0);
	});

	it("malformed stored data is unknown", () => {
		for (const raw of ["not json", "{}", '{"email":"a","providers":[1]}', "null"]) {
			expect(readStoredMethods({ getItem: () => raw }), raw).toBeNull();
		}
	});

	it("signingOut removes the methods with the remembered email, and the user seen triggers learning", () => {
		const storage = memoryStorage();
		const seen: string[] = [];
		const state = createSessionEnded({ storage, replaceLocation: () => undefined, onUserSeen: (u) => void seen.push(u.email) });
		state.sessionSeen({ id: "u1", email: "a@x" }, "s1");
		storage.map.set(REAUTH_METHODS_KEY, '{"email":"a@x","providers":["google"]}');
		expect(seen).toEqual(["a@x"]);
		expect(storage.map.has(REMEMBERED_EMAIL_KEY)).toBe(true);
		state.signingOut();
		expect(storage.map.has(REAUTH_METHODS_KEY)).toBe(false);
		expect(storage.map.has(REMEMBERED_EMAIL_KEY)).toBe(false);
	});
});

// --- startSocialReauth -----------------------------------------------------------------------

function harness(opts: { popup?: boolean; signIn?: SocialReauthDeps["signInSocial"]; confirm?: boolean } = {}) {
	const log: string[] = [];
	const states: SocialReauthState[] = [];
	const popup = { location: { href: "about:blank" }, close: () => void log.push("popup.close") };
	const channel = { onmessage: null as ((e: MessageEvent) => unknown) | null, close: () => void log.push("channel.close") };
	const focus = new Set<() => void>();
	const timers: { fn: () => void; ms: number; live: boolean }[] = [];
	const deps: SocialReauthDeps = {
		openWindow: (url, name, features) => {
			log.push(`open:${url}:${name}:${features}`);
			return opts.popup === false ? null : popup;
		},
		signInSocial:
			opts.signIn ??
			(async (args) => {
				log.push(`signInSocial:${JSON.stringify(args)}`);
				return { data: { url: "https://accounts.google.com/o/oauth2/auth?x=1" } };
			}),
		channel: () => channel,
		confirm: () => (log.push("confirm"), opts.confirm !== false),
		resume: () => void log.push("resume"),
		location: { href: "http://app.test/page?x=1" },
		refetchSession: () => void log.push("refetch"),
		onFocus: (l) => (focus.add(l), () => void focus.delete(l)),
		setTimeout: (fn, ms) => {
			const timer = { fn, ms, live: true };
			timers.push(timer);
			return timer;
		},
		clearTimeout: (h) => void ((h as { live: boolean } | undefined) && ((h as { live: boolean }).live = false)),
		onState: (s) => void states.push(s),
		onDisabled: () => void log.push("disabled"),
	};
	const message = (data: unknown) => channel.onmessage?.({ data } as MessageEvent);
	return { deps, log, states, popup, channel, focus, timers, message };
}

describe("startSocialReauth, popup open", () => {
	it("a popup that comes back already closed (blocker extension) is treated as blocked: redirect fallback, URL never assigned", async () => {
		const h = harness();
		(h.popup as { closed?: boolean }).closed = true;
		expect(await startSocialReauth("google", h.deps)).toBe("redirecting");
		expect(h.log).toContain("confirm");
		expect(h.log.some((l) => l.startsWith("signInSocial:") && !l.includes("disableRedirect"))).toBe(true);
		expect(h.popup.location.href).toBe("about:blank");
	});
	it("opens the popup before signInSocial is awaited (browsers block a popup opened after an await)", async () => {
		const h = harness();
		const run = startSocialReauth("google", h.deps);
		// Only the synchronous part has run: the popup is open, the request is in flight.
		expect(h.log[0]).toMatch(/^open:about:blank:auth-reauth:popup,/);
		expect(h.log.findIndex((l) => l.startsWith("signInSocial"))).toBeGreaterThan(0);
		await run;
	});

	it("asks for the completion page with relative callbacks and no redirect, then points the popup at the provider", async () => {
		const h = harness();
		expect(await startSocialReauth("google", h.deps)).toBe("popup");
		expect(JSON.parse(h.log.find((l) => l.startsWith("signInSocial"))!.slice("signInSocial:".length))).toEqual({
			provider: "google",
			callbackURL: REAUTH_COMPLETE_PATH,
			errorCallbackURL: `${REAUTH_COMPLETE_PATH}?error=1`,
			disableRedirect: true,
		});
		expect(h.popup.location.href).toBe("https://accounts.google.com/o/oauth2/auth?x=1");
		expect(h.states).toEqual(["busy"]);
	});

	it("an ok message refetches the session once and the channel is closed; a second message is ignored", async () => {
		const h = harness();
		await startSocialReauth("google", h.deps);
		h.message({ type: "reauth-complete", ok: true });
		h.message({ type: "reauth-complete", ok: true });
		expect(h.log.filter((l) => l === "refetch")).toHaveLength(1);
		expect(h.log).toContain("channel.close");
		expect(h.focus.size).toBe(0);
	});

	it("a failure that says the account is disabled leaves for the account-disabled page, once, and releases everything", async () => {
		const h = harness();
		await startSocialReauth("google", h.deps);
		h.message({ type: "reauth-complete", ok: false, reason: "account_disabled" });
		h.message({ type: "reauth-complete", ok: false, reason: "account_disabled" });
		expect(h.log.filter((l) => l === "disabled")).toHaveLength(1);
		expect(h.log).toContain("channel.close");
		expect(h.log).not.toContain("refetch");
		expect(h.focus.size).toBe(0);
		expect(h.states).toEqual(["busy"]);
	});

	it("an ordinary failure is not the disabled one", async () => {
		const h = harness();
		await startSocialReauth("google", h.deps);
		h.message({ type: "reauth-complete", ok: false });
		expect(h.log).not.toContain("disabled");
		expect(h.states).toEqual(["busy", "failed"]);
	});

	it("an unrelated message is ignored", async () => {
		const h = harness();
		await startSocialReauth("google", h.deps);
		h.message({ type: "something-else" });
		h.message(null);
		expect(h.log).not.toContain("refetch");
		expect(h.states).toEqual(["busy"]);
	});

	it("a not-ok message ends in the failed state and never refetches", async () => {
		const h = harness();
		await startSocialReauth("google", h.deps);
		h.message({ type: "reauth-complete", ok: false });
		expect(h.log).not.toContain("refetch");
		expect(h.states).toEqual(["busy", "failed"]);
	});

	it("a signInSocial error closes the popup and fails", async () => {
		const h = harness({ signIn: async () => ({ data: null, error: { message: "x" } }) });
		expect(await startSocialReauth("google", h.deps)).toBe("failed");
		expect(h.log).toContain("popup.close");
		expect(h.states).toEqual(["busy", "failed"]);
	});

	it("a response with no url, and a thrown request, fail the same way", async () => {
		for (const signIn of [async () => ({ data: {} }), async (): Promise<never> => { throw new Error("offline"); }]) {
			const h = harness({ signIn });
			expect(await startSocialReauth("google", h.deps)).toBe("failed");
			expect(h.log).toContain("popup.close");
			expect(h.states).toEqual(["busy", "failed"]);
		}
	});

	it("focus back on the opener makes the button usable again, and a completion still on its way is not lost", async () => {
		const h = harness();
		await startSocialReauth("google", h.deps);
		for (const l of [...h.focus]) l();
		expect(h.states).toEqual(["busy", "idle"]);
		h.message({ type: "reauth-complete", ok: true });
		expect(h.log).toContain("refetch");
	});

	it("an abandoned popup times out to idle and releases the channel", async () => {
		const h = harness();
		await startSocialReauth("google", h.deps);
		h.timers.find((t) => t.ms >= 60_000)!.fn();
		expect(h.states).toEqual(["busy", "idle"]);
		expect(h.log).toContain("channel.close");
	});

	it("a completion that does not restore the session leaves the button usable again", async () => {
		const h = harness();
		await startSocialReauth("google", h.deps);
		h.message({ type: "reauth-complete", ok: true });
		h.timers.at(-1)!.fn();
		expect(h.states).toEqual(["busy", "idle"]);
	});
});

describe("startSocialReauth, popup blocked", () => {
	it("confirms, then redirects the whole page back to where it is", async () => {
		const h = harness({ popup: false });
		expect(await startSocialReauth("google", h.deps)).toBe("redirecting");
		expect(h.log.map((l) => l.split(":")[0])).toEqual(["open", "confirm", "signInSocial"]);
		const args = JSON.parse(h.log[2]!.slice("signInSocial:".length));
		expect(args).toEqual({ provider: "google", callbackURL: "http://app.test/page?x=1", errorCallbackURL: "http://app.test/page?x=1&reauth_error=google" });
		expect(args.disableRedirect).toBeUndefined();
	});

	it("a cancelled confirm starts nothing", async () => {
		const h = harness({ popup: false, confirm: false });
		expect(await startSocialReauth("google", h.deps)).toBe("declined");
		expect(h.log.some((l) => l.startsWith("signInSocial"))).toBe(false);
		expect(h.states).toEqual([]);
	});

	it("a redirect that could not start puts the page back (guards and restore logic), never a frozen dialog", async () => {
		const h = harness({ popup: false, signIn: async () => ({ data: null, error: { message: "x" } }) });
		expect(await startSocialReauth("google", h.deps)).toBe("failed");
		expect(h.log).toContain("resume");
		expect(h.states).toEqual(["busy", "failed"]);
	});
});

describe("the real confirm and resume the dialog uses (the discard-for-navigation pair)", () => {
	afterEach(() => {
		setHeldRequests({ writes: 0 });
		resumeUnloadGuards();
		vi.unstubAllGlobals();
	});

	it("held writes: the user is asked, a refusal leaves the page as it was; accepting stands the unload guard down", () => {
		const asked: string[] = [];
		vi.stubGlobal("confirm", (m: string) => (asked.push(m), false));
		setHeldRequests({ writes: 1 });
		expect(pageNavigationDeps.confirm()).toBe(false);
		expect(asked).toHaveLength(1);
		expect(isUnloadGuardSuspended()).toBe(false);
		vi.stubGlobal("confirm", () => true);
		expect(pageNavigationDeps.confirm()).toBe(true);
		expect(isUnloadGuardSuspended()).toBe(true);
		pageNavigationDeps.resume();
		expect(isUnloadGuardSuspended()).toBe(false);
	});

	it("nothing held: no question", () => {
		vi.stubGlobal("confirm", () => {
			throw new Error("must not ask");
		});
		expect(pageNavigationDeps.confirm()).toBe(true);
	});
});

describe("registerReauthMethod", () => {
	afterEach(() => resetReauthMethods());
	const method = (providerId: string) => ({ providerId, Component: () => null });

	it("a registered method is offered to an account that has it, and only to that one", () => {
		registerReauthMethod(method("magic-link"));
		const ids = registeredReauthIds();
		expect(resolveReauthMethods({ email: "a@x", providers: ["magic-link"] }, "a@x", [], ids).registered).toEqual(["magic-link"]);
		expect(resolveReauthMethods({ email: "a@x", providers: ["credential"] }, "a@x", [], ids).registered).toEqual([]);
	});
	it("a method with its own `offer` is shown to an account with no provider account, and to one with only a password", () => {
		registerReauthMethod({ ...method("magic-link"), offer: () => true });
		const ids = registeredReauthIds();
		const rules = registeredOfferRules();
		expect(resolveReauthMethods({ email: "a@x", providers: [] }, "a@x", [], ids, rules)).toEqual({ password: false, social: [], registered: ["magic-link"] });
		expect(resolveReauthMethods({ email: "a@x", providers: ["credential"] }, "a@x", [], ids, rules)).toEqual({ password: true, social: [], registered: ["magic-link"] });
		// Unknown methods stay unknown: nothing registered is offered.
		expect(resolveReauthMethods(null, "a@x", [], ids, rules).registered).toEqual([]);
	});
	it("an `offer` that says no hides the method; a method without one keeps the providerId rule", () => {
		registerReauthMethod({ ...method("passkey"), offer: (m) => m.includes("credential") });
		registerReauthMethod(method("magic-link"));
		const ids = registeredReauthIds();
		const rules = registeredOfferRules();
		expect(resolveReauthMethods({ email: "a@x", providers: ["google"] }, "a@x", [], ids, rules).registered).toEqual([]);
		expect(resolveReauthMethods({ email: "a@x", providers: ["credential", "magic-link"] }, "a@x", [], ids, rules).registered).toEqual(["passkey", "magic-link"]);
	});
	it("refuses a reserved id (the dialog already renders it)", () => {
		expect(() => registerReauthMethod(method("credential"))).toThrow(/already handled/);
		expect(() => registerReauthMethod(method("google"))).toThrow(/already handled/);
		expect(registeredReauthIds()).toEqual([]);
	});
	it("refuses a duplicate id and keeps the first", () => {
		const first = method("magic-link");
		registerReauthMethod(first);
		expect(() => registerReauthMethod(method("magic-link"))).toThrow(/already registered/);
		expect(registeredReauthIds()).toEqual(["magic-link"]);
	});
});

describe("takeReauthError", () => {
	it("no marker, no error: nothing to say", () => {
		expect(takeReauthError("http://app.test/page?x=1")).toEqual({ failed: false, provider: null, cleanHref: "http://app.test/page?x=1" });
	});
	it("an unrelated error without our marker is left alone", () => {
		const href = "http://app.test/page?x=1&error=access_denied";
		expect(takeReauthError(href)).toEqual({ failed: false, provider: null, cleanHref: href });
	});
	it("our marker with Better Auth's error: failed for that provider, everything added stripped, the rest kept", () => {
		expect(takeReauthError("http://app.test/page?x=1&reauth_error=google&error=access_denied&error_description=no#h")).toEqual({ failed: true, provider: "google", cleanHref: "/page?x=1#h" });
	});
	it("the marker alone is not a failure: it is stripped and nothing is shown", () => {
		expect(takeReauthError("http://app.test/page?x=1&reauth_error=google#h")).toEqual({ failed: false, provider: null, cleanHref: "/page?x=1#h" });
	});
	it("a provider id the app does not know is never shown: parameters stripped, no failure", () => {
		for (const id of ["Call%20555-0100", "unknown", "", "toString", "__proto__", "constructor"]) {
			expect(takeReauthError(`http://app.test/page?x=1&reauth_error=${id}&error=access_denied&error_description=x`), id).toEqual({ failed: false, provider: null, cleanHref: "/page?x=1" });
		}
	});
	it("the callback URL we send round-trips through it", () => {
		const url = reauthErrorCallbackURL("http://app.test/page?x=1", "google");
		expect(url).toBe("http://app.test/page?x=1&reauth_error=google");
		expect(takeReauthError(`${url}&error=failed`)).toEqual({ failed: true, provider: "google", cleanHref: "/page?x=1" });
	});
});

describe("reauthUrlNeedsCleanup", () => {
	it("is true for a hostile marker that takeReauthError strips without failing, false for an untouched URL", () => {
		const hostile = "http://app.test/page?x=1&reauth_error=Call%20555-0100";
		const r = takeReauthError(hostile);
		expect(r.failed).toBe(false);
		expect(reauthUrlNeedsCleanup(hostile, r.cleanHref)).toBe(true);
		const plain = "http://app.test/page?x=1#h";
		expect(reauthUrlNeedsCleanup(plain, takeReauthError(plain).cleanHref)).toBe(false);
	});
});
