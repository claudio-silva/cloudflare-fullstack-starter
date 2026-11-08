import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { background, isBackgroundRoute } from "../src/worker/lib/route-kind";

const reader = (c: import("hono").Context) => c.text(String(isBackgroundRoute(c)));
const read = async (app: Hono, path: string) => (await app.request(path)).text();

describe("route kinds", () => {
	it("is a normal route without the marker", async () => {
		const app = new Hono();
		app.get("/n", reader);
		expect(await read(app, "/n")).toBe("false");
	});

	it("is background with the marker before the reader", async () => {
		const app = new Hono();
		app.get("/b", background, reader);
		expect(await read(app, "/b")).toBe("true");
	});

	it("is background with the marker after the reader (matched handlers)", async () => {
		const app = new Hono();
		// The reader runs first and passes on; the marker's handler is still in the matched list.
		app.get("/b", async (c, next) => {
			c.header("x-seen", String(isBackgroundRoute(c)));
			return next();
		}, background, reader);
		const res = await app.request("/b");
		expect(res.headers.get("x-seen")).toBe("true");
		expect(await res.text()).toBe("true");
	});

	it("is background for a marker on a sub-app mounted with app.route", async () => {
		const sub = new Hono();
		sub.get("/b", background, reader);
		const app = new Hono();
		app.route("/sub", sub);
		expect(await read(app, "/sub/b")).toBe("true");
	});

	it("does not leak to another route", async () => {
		const app = new Hono();
		app.get("/b", background, reader);
		app.get("/n", reader);
		await read(app, "/b");
		expect(await read(app, "/n")).toBe("false");
	});

	it("is still background for a sub-app with its own onError, when the marker is listed before the reader", async () => {
		// Hono wraps the handlers of a sub-app that has its own onError, which hides the marker from
		// matchedRoutes (so listing it after the reader would not work there), but the flag it sets still does.
		const sub = new Hono();
		sub.onError((err, c) => c.text(err.message, 500));
		sub.get("/b", background, reader);
		sub.get("/n", reader);
		const app = new Hono();
		app.route("/sub", sub);
		expect(await read(app, "/sub/b")).toBe("true");
		expect(await read(app, "/sub/n")).toBe("false");
	});
});
