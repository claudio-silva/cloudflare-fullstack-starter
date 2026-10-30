/**
 * The text the starter itself shows, and the one seam through which an app
 * translates it.
 *
 * Deliberately not an i18n library. Choosing one (i18next, FormatJS, Lingui,
 * Paraglide…) is the app's decision, and the starter's own strings must not
 * make it first. So the starter ships English defaults under stable keys, and
 * the app plugs in whatever it chose:
 *
 *   // i18next
 *   setTranslator((key, params) => (i18n.exists(key) ? i18n.t(key, params) : undefined));
 *
 *   // no library: a single language, a few words changed
 *   overrideMessages({ "update.now": "Actualizar agora", "update.later": "Adiar" });
 *
 * Placeholders are `{name}`, which is also ICU MessageFormat's simple
 * argument, so the same strings work in FormatJS and Lingui as they are.
 *
 * A translator that returns `undefined` falls back to the default, so a
 * partial translation never shows a raw key.
 */

export const defaultMessages = {
	// Maintenance (lib/http/maintenance.ts)
	"maintenance.title": "{app} is being updated.",
	"maintenance.body": "Please wait until the service is available again.",
	"maintenance.countdown": "Checking again in {seconds}s…",
	"maintenance.checking": "Checking…",

	// Lost connection (lib/http/connectivity.ts)
	"connection.title": "No connection to {app}.",
	"connection.held": "What you were doing is on hold and will carry on when the connection returns.",
	"connection.countdown": "Trying again in {seconds}s…",
	"connection.checking": "Trying again…",
	"connection.waitingForNetwork": "Waiting for the network…",
	"connection.reconnecting": "Connection restored. Sending what was on hold…",
	"connection.retry": "Try now",
	"connection.cancel": "Cancel",
	"connection.cancelled": "The operation was cancelled.",

	// Error responses (lib/http/interceptor.ts). `http.<status>` is used when the
	// server gave no message of its own; `http.4xx` when there is no specific one.
	"http.400": "The request could not be processed.",
	"http.401": "Your session has expired. Please sign in again.",
	"http.403": "You are not allowed to do that.",
	"http.404": "Not found.",
	"http.409": "That conflicts with a change made in the meantime. Reload and try again.",
	"http.413": "That is too large to send.",
	"http.429": "Too many requests. Please wait a moment and try again.",
	"http.4xx": "The request could not be completed.",
	"http.5xx": "The operation could not be completed. Please try again in a moment; if it keeps happening, contact support.",
	"http.reference": "Reference: {id}",

	// New version (lib/http/version.ts)
	"update.title": "A new version of the app is available.",
	"update.body": "To make sure the app works correctly, you should update it now.",
	"update.unsaved": "If you are writing something you have not saved yet, click {later} and save your work now.",
	"update.postponed": "If you postpone, {app} will update itself in {minutes} minutes.",
	"update.now": "Update now",
	"update.later": "Postpone",
	"update.banner": "A new version of {app} is available.",
	"update.bannerCountdown": "It will update itself in {time}.",
	"update.bannerSoon": "{seconds} seconds left before the update. Save any pending changes now!",
	"update.bannerAction": "Update now",
	"update.requiredTitle": "{app} has been updated.",
	"update.requiredBody": "This page is running an older version that no longer works with the server. Update it to continue.",

	// Action buttons and their toasts (components/actions/)
	"actions.save": "Save",
	"actions.cancel": "Cancel",
	"actions.back": "Back",
	"actions.new": "New",
	"actions.delete": "Delete",
	"actions.print": "Print",
	"actions.created": "Created.",
	"actions.saved": "Saved.",
	"actions.deleted": "Deleted.",
	"actions.discarded": "Changes discarded.",
	"actions.saveFailed": "The changes could not be saved.",
	"actions.deleteFailed": "It could not be deleted.",
	"actions.deleteTitle": "Delete this record?",
	"actions.deleteBody": "This cannot be undone.",
	"actions.unsavedTitle": "Save your changes?",
	"actions.unsavedBody": "You have changes that have not been saved yet.",
	"actions.keepEditing": "Keep editing",
	"actions.discard": "Discard",
} as const;

export type MessageKey = keyof typeof defaultMessages;
export type MessageParams = Record<string, string | number>;

/**
 * Returns the translation, or `undefined` to fall back to the default.
 * `key` is a `MessageKey`, or `error.<code>` for a server error code.
 */
export type Translator = (key: string, params: MessageParams) => string | undefined;

let translator: Translator | null = null;
let overrides: Partial<Record<MessageKey, string>> = {};

export function setTranslator(fn: Translator | null): void {
	translator = fn;
}

let locale: string | null = null;

/** The language names of places (countries) are shown in: the one set with `setLocale()`, else the page's, else the browser's. */
export function getLocale(): string {
	// i18n.ts is also compiled where there is no DOM (the Worker's tests), hence `globalThis`.
	const g = globalThis as { document?: { documentElement: { lang: string } }; navigator?: { language: string } };
	return locale ?? (g.document?.documentElement.lang || g.navigator?.language || "en");
}

/** Call it with the app's language when it has a language switch; country names follow it. */
export function setLocale(next: string | null): void {
	locale = next;
}

export function overrideMessages(messages: Partial<Record<MessageKey, string>>): void {
	overrides = { ...overrides, ...messages };
}

export function format(template: string, params: MessageParams = {}): string {
	return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

/** The text for one of the starter's own keys. */
export function t(key: MessageKey, params: MessageParams = {}): string {
	return translator?.(key, params) ?? format(overrides[key] ?? defaultMessages[key], params);
}

/**
 * The text for a key the starter does not define (a server error code, say),
 * with the caller's fallback when the app has no translation for it.
 */
export function translate(key: string, fallback: string, params: MessageParams = {}): string {
	return translator?.(key, params) ?? format(fallback, params);
}
