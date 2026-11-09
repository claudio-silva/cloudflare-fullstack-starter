import type { Context } from "hono";
import type { AppEnv } from "./env";

export type AppUser = {
	id: string;
	email: string;
	name?: string | null;
	/** See src/shared/roles.ts. */
	role?: string | null;
};

export type AppBindings = {
	Bindings: AppEnv;
	Variables: {
		user: AppUser | null;
		session: unknown;
		/** Set by versionMiddleware: the Cloudflare ray id, or a generated one where there is none. */
		requestId: string;
		/** Set by the `background` route marker (lib/route-kind.ts). */
		routeKindBackground?: boolean;
		/** Set by the session-create hook when it refused a disabled user in this request (lib/sign-in-guard.ts). */
		sessionRefusedForDisabled?: boolean;
	};
};

export type AppContext = Context<AppBindings>;

