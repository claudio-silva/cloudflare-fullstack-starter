import { afterEach, describe, expect, it, vi } from "vitest";

// The page's default session state reads localStorage once, at import.
vi.hoisted(() => {
	const map = new Map<string, string>();
	(globalThis as { localStorage?: unknown }).localStorage = {
		getItem: (k: string) => map.get(k) ?? null,
		setItem: (k: string, v: string) => void map.set(k, v),
		removeItem: (k: string) => void map.delete(k),
	};
});
import { withSessionEndedGuard, getSessionEnded } from "../src/react-app/lib/auth/session-ended";
import { resumeUnloadGuards, setHeldRequests } from "../src/react-app/lib/auth/held-requests";
import { confirmAndDiscardForNavigation, switchAccount } from "../src/react-app/components/auth/leave-session";
import { defaultMessages } from "../src/react-app/lib/i18n";

const win = new EventTarget();
vi.stubGlobal("addEventListener", win.addEventListener.bind(win));
vi.stubGlobal("removeEventListener", win.removeEventListener.bind(win));

function unloadPrompts(): boolean {
	const event = new Event("beforeunload", { cancelable: true });
	// A browser's BeforeUnloadEvent has a writable `returnValue`; workerd's Event does not.
	Object.defineProperty(event, "returnValue", { writable: true, value: true });
	win.dispatchEvent(event);
	return event.defaultPrevented;
}

afterEach(() => {
	setHeldRequests({ writes: 0 });
	resumeUnloadGuards();
	getSessionEnded().resume();
});

describe("leaving from the re-login dialog", () => {
	it("a held write: one confirm, then no native prompt either", () => {
		setHeldRequests({ writes: 1 });
		expect(unloadPrompts()).toBe(true);
		const asked: string[] = [];
		expect(confirmAndDiscardForNavigation((m) => (asked.push(m), true), null)).toBe(true);
		expect(asked).toEqual([defaultMessages["session.discardHeld"]]);
		expect(unloadPrompts()).toBe(false);
		expect(getSessionEnded().isLeaving()).toBe(true);
	});

	it("declining keeps the page guarded and not leaving", () => {
		setHeldRequests({ writes: 1 });
		expect(confirmAndDiscardForNavigation(() => false, null)).toBe(false);
		expect(unloadPrompts()).toBe(true);
		expect(getSessionEnded().isLeaving()).toBe(false);
	});

	it("nothing held: no confirm at all", () => {
		expect(confirmAndDiscardForNavigation(() => expect.fail("must not ask"), null)).toBe(true);
	});

	it("bfcache: a persisted pageshow resumes the guards; a plain one does not", () => {
		setHeldRequests({ writes: 1 });
		const listeners: ((e: Event) => void)[] = [];
		const target = { addEventListener: (_t: string, l: (e: Event) => void) => void listeners.push(l) };
		expect(confirmAndDiscardForNavigation(() => true, target)).toBe(true);
		listeners[0]({ persisted: false } as unknown as Event);
		expect(unloadPrompts()).toBe(false);
		expect(getSessionEnded().isLeaving()).toBe(true);
		listeners[0]({ persisted: true } as unknown as Event);
		expect(unloadPrompts()).toBe(true);
		expect(getSessionEnded().isLeaving()).toBe(false);
	});
});

describe("switchAccount", () => {
	it("signs out, then navigates", async () => {
		const order: string[] = [];
		const left = await switchAccount({
			confirmFn: () => true,
			target: null,
			signOut: async () => void order.push("signOut"),
			navigate: () => void order.push("navigate"),
			onLeaving: () => void order.push("leaving"),
		});
		expect(left).toBe(true);
		expect(order).toEqual(["leaving", "signOut", "navigate"]);
	});

	it("a declined confirm neither signs out nor navigates", async () => {
		setHeldRequests({ writes: 1 });
		const called: string[] = [];
		const left = await switchAccount({
			confirmFn: () => false,
			target: null,
			signOut: async () => void called.push("signOut"),
			navigate: () => void called.push("navigate"),
		});
		expect(left).toBe(false);
		expect(called).toEqual([]);
	});

	it("a hanging sign-out still navigates once the timeout passes; a failing one at once", async () => {
		let navigated = 0;
		await switchAccount({ confirmFn: () => true, target: null, timeoutMs: 20, signOut: () => new Promise(() => undefined), navigate: () => void navigated++ });
		expect(navigated).toBe(1);
		await switchAccount({ confirmFn: () => true, target: null, signOut: () => Promise.reject(new Error("network")), navigate: () => void navigated++ });
		expect(navigated).toBe(2);
	});
});

describe("forgot-password from the dialog, then Back from the bfcache", () => {
	it("a persisted pageshow restores the session logic, so the dialog sign-in replays the held write", async () => {
		const listeners: ((e: Event) => void)[] = [];
		const target = { addEventListener: (_t: string, l: (e: Event) => void) => void listeners.push(l) };
		const state = getSessionEnded();
		state.sessionSeen({ id: "u1", email: "a@x" });
		let authed = false;
		const calls: string[] = [];
		const f = withSessionEndedGuard(
			(async (input: RequestInfo | URL) => {
				calls.push(String(input));
				await Promise.resolve();
				return new Response("{}", { status: authed ? 200 : 401 });
			}) as typeof fetch,
			state,
			"http://app.test",
			{ onHeldChange: (_n, summary) => setHeldRequests(summary) },
		);
		const pending = f("/api/profile", { method: "POST", body: "{}" });
		for (let i = 0; i < 20; i++) await Promise.resolve();
		expect(state.isEnded()).toBe(true);
		// The link: what LoginForm calls, then the page goes away and comes back from the bfcache.
		expect(confirmAndDiscardForNavigation(() => true, target)).toBe(true);
		listeners[0]({ persisted: true } as unknown as Event);
		expect(unloadPrompts()).toBe(true);
		authed = true;
		state.sessionSeen({ id: "u1", email: "a@x" });
		expect((await pending).status).toBe(200);
		expect(state.isEnded()).toBe(false);
		expect(calls).toEqual(["/api/profile", "/api/profile"]);
	});
});
