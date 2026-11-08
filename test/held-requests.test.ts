import { afterEach, describe, expect, it, vi } from "vitest";
import {
	confirmDiscardHeldRequests,
	hasHeldRequests,
	isUnloadGuardSuspended,
	resumeUnloadGuards,
	setHeldRequests,
	standDownUnloadGuards,
} from "../src/react-app/lib/auth/held-requests";
import { defaultMessages } from "../src/react-app/lib/i18n";

/** The window the unload guard listens on: a plain event target standing in for it. */
const win = new EventTarget();
vi.stubGlobal("addEventListener", win.addEventListener.bind(win));
vi.stubGlobal("removeEventListener", win.removeEventListener.bind(win));

/** Fires `beforeunload` and reports whether a guard asked the browser to prompt. */
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
});

describe("the unload guard", () => {
	it("prompts only while writes are held", () => {
		expect(unloadPrompts()).toBe(false);
		setHeldRequests({ writes: 1 });
		expect(unloadPrompts()).toBe(true);
		setHeldRequests({ writes: 2 });
		setHeldRequests({ writes: 0 });
		expect(unloadPrompts()).toBe(false);
	});

	it("is not stacked by repeated updates: one drop in writes removes it", () => {
		setHeldRequests({ writes: 1 });
		setHeldRequests({ writes: 1 });
		setHeldRequests({ writes: 3 });
		setHeldRequests({ writes: 0 });
		expect(unloadPrompts()).toBe(false);
	});

	it("stands down for a deliberate leave and is back after the back/forward cache", () => {
		setHeldRequests({ writes: 1 });
		standDownUnloadGuards();
		expect(isUnloadGuardSuspended()).toBe(true);
		expect(unloadPrompts()).toBe(false);
		resumeUnloadGuards();
		expect(unloadPrompts()).toBe(true);
	});
});

describe("confirmDiscardHeldRequests", () => {
	it("nothing held: leaving is free and nothing is asked", () => {
		const asked: string[] = [];
		expect(confirmDiscardHeldRequests((m) => (asked.push(m), false))).toBe(true);
		expect(asked).toEqual([]);
		expect(hasHeldRequests()).toBe(false);
	});

	it("a write held: asks once with the starter's copy, and obeys the answer", () => {
		setHeldRequests({ writes: 1 });
		const asked: string[] = [];
		expect(confirmDiscardHeldRequests((m) => (asked.push(m), false))).toBe(false);
		expect(confirmDiscardHeldRequests(() => true)).toBe(true);
		expect(asked).toEqual([defaultMessages["session.discardHeld"]]);
	});
});
