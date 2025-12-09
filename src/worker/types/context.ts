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
	};
};

export type AppContext = Context<AppBindings>;

