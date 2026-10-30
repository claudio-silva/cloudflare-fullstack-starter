import { afterEach, describe, expect, it, vi } from "vitest";
import { ACTION_EVENT, emitAction, setActionEvents, setActionHandler } from "../src/react-app/components/actions/events";

/**
 * The action buttons' global events (src/react-app/components/actions/events.ts):
 * a toast by default in the right colour, replaceable per action, silenced
 * globally, and a DOM event a listener can cancel.
 */

const toasts = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

/** `window` in the browser; the Worker's global scope types only its own events. */
const target = globalThis as unknown as EventTarget;

afterEach(() => {
	vi.clearAllMocks();
	setActionEvents(true);
	for (const action of ["created", "saved", "deleted", "discarded"] as const) setActionHandler(action, undefined);
});

describe("action events", () => {
	it("toast by default: success for created, info for saved, info for deleted, warning for discarded", () => {
		emitAction("created");
		emitAction("saved", { message: "User saved." });
		emitAction("deleted");
		emitAction("discarded");
		expect(toasts.success).toHaveBeenCalledWith("Created.");
		expect(toasts.info).toHaveBeenCalledWith("User saved.");
		expect(toasts.info).toHaveBeenCalledWith("Deleted.");
		expect(toasts.warning).toHaveBeenCalledWith("Changes discarded.");
		expect(toasts.error).not.toHaveBeenCalled();
	});

	it("a handler replaces the default; null silences it; undefined restores it", () => {
		const handler = vi.fn();
		setActionHandler("saved", handler);
		emitAction("saved", { id: "7" });
		expect(handler).toHaveBeenCalledWith({ action: "saved", id: "7" });
		expect(toasts.info).not.toHaveBeenCalled();

		setActionHandler("saved", null);
		emitAction("saved");
		expect(toasts.info).not.toHaveBeenCalled();

		setActionHandler("saved", undefined);
		emitAction("saved");
		expect(toasts.info).toHaveBeenCalledOnce();
	});

	it("turned off, nothing runs and no DOM event is sent", () => {
		const listener = vi.fn();
		target.addEventListener(ACTION_EVENT, listener);
		setActionEvents(false);
		emitAction("created");
		target.removeEventListener(ACTION_EVENT, listener);
		expect(listener).not.toHaveBeenCalled();
		expect(toasts.success).not.toHaveBeenCalled();
	});

	it("a DOM listener sees the event first and can cancel the handler", () => {
		const listener = vi.fn((event: Event) => {
			expect((event as CustomEvent).detail).toEqual({ action: "deleted", id: "3" });
			event.preventDefault();
		});
		target.addEventListener(ACTION_EVENT, listener);
		emitAction("deleted", { id: "3" });
		target.removeEventListener(ACTION_EVENT, listener);
		expect(listener).toHaveBeenCalledOnce();
		expect(toasts.info).not.toHaveBeenCalled();
	});
});
