import { Hono } from "hono";
import type { AppBindings } from "../types/context";
import { authMiddleware } from "../middleware/auth";

/** Durable Object usage example, mounted at `/api/counter`. Safe to delete. */
export const exampleCounter = new Hono<AppBindings>();

exampleCounter.use("*", authMiddleware);

exampleCounter.post("/:name/increment", async (c) => {
	const stub = c.env.EXAMPLE_COUNTER.get(c.env.EXAMPLE_COUNTER.idFromName(c.req.param("name")));
	return c.json({ count: await stub.increment() });
});

exampleCounter.get("/:name", async (c) => {
	const stub = c.env.EXAMPLE_COUNTER.get(c.env.EXAMPLE_COUNTER.idFromName(c.req.param("name")));
	return c.json({ count: await stub.value() });
});
