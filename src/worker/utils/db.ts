import type { AppContext } from "../types/context";

export const requireDb = (c: AppContext) => {
	if (!c.env.DB) {
		throw new Error("Database binding unavailable");
	}
	return c.env.DB;
};
