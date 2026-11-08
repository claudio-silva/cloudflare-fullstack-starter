import type { ComponentType } from "react";

/**
 * What the re-login dialog offers: the way the account actually signs in.
 *
 * The account's methods are learned while the page is healthy (`rememberSignInMethods`), because once
 * the session has ended nothing can be asked of the server. They are kept beside the remembered email.
 * A password is never asked of an account that has none.
 */

/** localStorage key: `{ email, providers }` of the last signed-in user. Removed by a sign-out, with the remembered email. */
export const REAUTH_METHODS_KEY = "auth.lastMethods";

export type StoredMethods = { email: string; providers: string[] };

export type ReauthChoice = {
	/** Ask for the password (the account has a `credential`, or its methods are unknown). */
	password: boolean;
	/** Social provider ids to offer a "Continue with" button for. */
	social: string[];
	/** Ids of app-registered methods (`registerReauthMethod`) the account has. */
	registered: string[];
};

/**
 * Pure. Unknown (nothing stored, or stored for another email) offers everything this deployment has,
 * and no registered method: it cannot be known that the account has one.
 */
export function resolveReauthMethods(
	stored: StoredMethods | null,
	rememberedEmail: string,
	offeredSocial: readonly string[],
	registeredIds: readonly string[],
	/** Per registered id, the method's own `offer` rule (`registeredOfferRules()`); an id without one is offered when the account has it. */
	offerRules: ReadonlyMap<string, (methods: string[]) => boolean> = new Map(),
): ReauthChoice {
	if (!stored || stored.email !== rememberedEmail) return { password: true, social: [...offeredSocial], registered: [] };
	const providers = new Set(stored.providers);
	return {
		password: providers.has("credential"),
		social: offeredSocial.filter((id) => providers.has(id)),
		registered: registeredIds.filter((id) => {
			const offer = offerRules.get(id);
			return offer ? offer([...providers]) : providers.has(id);
		}),
	};
}

/** The social providers this deployment offers. The one place a future provider is added. */
export function offeredSocialProviders(features: { google: boolean }): string[] {
	return features.google ? ["google"] : [];
}

const PROVIDER_NAMES: Record<string, string> = { google: "Google" };

/** "Google" for `google`; any other id with its first letter capitalised. */
export function socialProviderName(id: string): string {
	return PROVIDER_NAMES[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

/** Reads the stored methods; anything malformed is "unknown". */
export function readStoredMethods(storage: Pick<Storage, "getItem"> | null): StoredMethods | null {
	try {
		const raw = storage?.getItem(REAUTH_METHODS_KEY);
		if (!raw) return null;
		const value = JSON.parse(raw) as Partial<StoredMethods> | null;
		if (value && typeof value.email === "string" && Array.isArray(value.providers) && value.providers.every((p) => typeof p === "string")) {
			return { email: value.email, providers: value.providers };
		}
	} catch {
		// Unreadable: unknown.
	}
	return null;
}

// --- Methods an app adds ------------------------------------------------------------------------

export type ReauthMethod = {
	/** The Better Auth account `providerId` that means "this account signs in this way". */
	providerId: string;
	/**
	 * Decides, from the provider ids of the account's Better Auth accounts, whether this method is
	 * offered. Omitted: offered when `providerId` is among them. A method whose sign-in leaves no
	 * account row (Better Auth's magic link writes none) sets it, for example `offer: () => true`.
	 * Never consulted when the account's methods are unknown.
	 */
	offer?: (methods: string[]) => boolean;
	/** Rendered in the dialog for an account that has it: for example a "send me a link" button. */
	Component: ComponentType<{ email: string }>;
};

const registry = new Map<string, ReauthMethod>();

/** Ids the dialog already renders itself: the password and every social provider this deployment can offer. */
function reservedIds(): string[] {
	return ["credential", ...Object.keys(PROVIDER_NAMES)];
}

/**
 * An app that adds a sign-in method (a magic link, say) registers how to re-authenticate with it.
 * The starter registers none. The component must complete the sign-in in a way that ends in a new
 * session for the same page (a popup, or a link opened elsewhere) and never navigates this page
 * away without `confirmAndDiscardForNavigation` (components/auth/leave-session.ts).
 *
 * Throws on a reserved id (`credential`, or a social provider the dialog offers itself) and on an id
 * already registered: either would render the method twice, or silently replace another one. It is a
 * programming error, so it fails at registration (module load), not in front of a user.
 */
export function registerReauthMethod(method: ReauthMethod): void {
	if (reservedIds().includes(method.providerId)) throw new Error(`registerReauthMethod: "${method.providerId}" is already handled by the re-login dialog`);
	if (registry.has(method.providerId)) throw new Error(`registerReauthMethod: "${method.providerId}" is already registered`);
	registry.set(method.providerId, method);
}

/** Test only: empties the registry. */
export function resetReauthMethods(): void {
	registry.clear();
}

export function registeredReauthMethod(providerId: string): ReauthMethod | undefined {
	return registry.get(providerId);
}

/** The `offer` rule of every registered method that has one, for `resolveReauthMethods`. */
export function registeredOfferRules(): Map<string, (methods: string[]) => boolean> {
	const rules = new Map<string, (methods: string[]) => boolean>();
	for (const [id, method] of registry) if (method.offer) rules.set(id, method.offer);
	return rules;
}

export function registeredReauthIds(): string[] {
	return [...registry.keys()];
}

// --- Learning --------------------------------------------------------------------------------------

export type LearnDeps = {
	/** The provider ids of the signed-in user's accounts, or null when they could not be read. */
	listProviders: () => Promise<string[] | null>;
	storage: Pick<Storage, "setItem"> | null;
};

let learned = false;
let learning = false;
let generation = 0;

/** A sign-out forgets what was learned (the next sign-in may be another account), and so does a test. */
export function resetLearning(): void {
	learned = false;
	learning = false;
	generation++;
}

/**
 * Once per tab load, after the first session seen with a user: stores that user's distinct account
 * provider ids with their email. A failure stores nothing (and the next session seen tries again).
 */
export async function rememberSignInMethods(email: string, deps: LearnDeps): Promise<void> {
	if (learned || learning) return;
	learning = true;
	const started = generation;
	try {
		const providers = await deps.listProviders();
		// Nothing: unreadable, or a sign-out came in between (the answer belongs to the account that left).
		if (!providers || started !== generation) return;
		deps.storage?.setItem(REAUTH_METHODS_KEY, JSON.stringify({ email, providers: [...new Set(providers)] } satisfies StoredMethods));
		learned = true;
	} catch {
		// Not learned: the dialog treats the account as unknown.
	} finally {
		if (started === generation) learning = false;
	}
}

let loader: (() => Promise<string[] | null>) | null = null;

/** Installed by `lib/auth/client.ts`, which owns the Better Auth client (this module must not import it: a cycle). */
export function setProvidersLoader(fn: () => Promise<string[] | null>): void {
	loader = fn;
}

/** What the session-ended state calls when it sees a signed-in user. */
export function learnSignInMethods(email: string, storage: Pick<Storage, "setItem"> | null): void {
	if (!loader) return;
	void rememberSignInMethods(email, { listProviders: loader, storage });
}
