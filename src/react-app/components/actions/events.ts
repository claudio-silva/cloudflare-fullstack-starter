import { toast } from "sonner";
import { t } from "../../lib/i18n";

/**
 * What the action buttons (ButtonSave, ButtonDelete…) announce once they have
 * done their job. Each is a global event: by default a few show a toast, and an
 * app can silence them all, replace what one does, or just listen.
 *
 *   setActionEvents(false);                                   // nothing at all, not even the DOM event
 *   setActionHandler("saved", (d) => myToast(d.message));     // replaces the default toast
 *   setActionHandler("deleted", null);                        // this one does nothing
 *   setActionHandler("deleted", undefined);                   // back to the default
 *   addEventListener("app:action", (e) => { … e.preventDefault(); });  // listen; preventDefault skips the handler
 *
 * Toast colours: success for something created, info for a save or a deletion
 * (red is kept for errors), warning for discarded changes.
 */
export type ActionName = "new" | "created" | "saved" | "deleted" | "discarded" | "back" | "print";

export type ActionDetail = {
	action: ActionName;
	/** The record's id, when there is one. */
	id?: string;
	/** Replaces the default text of the toast. */
	message?: string;
};

export type ActionHandler = (detail: ActionDetail) => void;

/** The DOM event dispatched on `window` before the handler runs. */
export const ACTION_EVENT = "app:action";

const DEFAULTS: Partial<Record<ActionName, ActionHandler>> = {
	created: (d) => toast.success(d.message ?? t("actions.created")),
	saved: (d) => toast.info(d.message ?? t("actions.saved")),
	deleted: (d) => toast.info(d.message ?? t("actions.deleted")),
	discarded: (d) => toast.warning(d.message ?? t("actions.discarded")),
};

let enabled = true;
const handlers = new Map<ActionName, ActionHandler | null>();

/** Turns every action event on or off, the DOM event included. */
export function setActionEvents(on: boolean): void {
	enabled = on;
}

/** `null` silences the action; `undefined` restores its default. */
export function setActionHandler(action: ActionName, handler: ActionHandler | null | undefined): void {
	if (handler === undefined) handlers.delete(action);
	else handlers.set(action, handler);
}

export function emitAction(action: ActionName, detail: Omit<ActionDetail, "action"> = {}): void {
	if (!enabled) return;
	const full: ActionDetail = { ...detail, action };
	const target = globalThis as unknown as { dispatchEvent?: (event: Event) => boolean };
	if (typeof CustomEvent === "function" && target.dispatchEvent) {
		if (!target.dispatchEvent(new CustomEvent(ACTION_EVENT, { detail: full, cancelable: true }))) return;
	}
	const handler = handlers.has(action) ? handlers.get(action) : DEFAULTS[action];
	handler?.(full);
}
