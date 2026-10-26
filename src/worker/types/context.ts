import type { Context } from "hono";
import type { AppEnv } from "./env";

export type AppUser = {
	id: string;
	email: string;
	name?: string | null;
};

export type AppBindings = {
	Bindings: AppEnv;
	Variables: {
		user: AppUser | null;
		session: unknown;
		/** Set by versionMiddleware: the Cloudflare ray id, or a generated one where there is none. */
		requestId: string;
	};
};

export type AppContext = Context<AppBindings>;

