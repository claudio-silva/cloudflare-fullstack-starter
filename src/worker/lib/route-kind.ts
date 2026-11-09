import type { Context, MiddlewareHandler } from "hono";
import { matchedRoutes } from "hono/route";

/**
 * Route kinds: every route is "normal" (the default) or "background".
 *
 * A background route is one the client hits without the user having done anything: polling,
 * heartbeats, periodic checks, background tasks. A request to a background route must not keep a
 * session alive; a request to a normal route does.
 *
 * A route opts in by listing the marker among its handlers, in any position relative to the auth
 * middleware:
 *
 *     app.get("/api/status", background, authMiddleware, handler);
 *
 * The session code asks `isBackgroundRoute(c)`, which reads Hono's matched handlers. Routes never
 * deal with session refresh themselves. Generic on purpose: no application knowledge lives here.
 */
export const background: MiddlewareHandler = async (c, next) => {
	c.set("routeKindBackground", true);
	return next();
};

/**
 * True when any handler matched for this request is the `background` marker, wherever it was
 * registered. Hono wraps the handlers of a sub-app that has its own `onError`, which hides the
 * marker from `matchedRoutes`; there the marker still works when it runs before the reader (the
 * flag it sets), so list it before the auth middleware on such sub-apps.
 */
export function isBackgroundRoute(c: Context): boolean {
	return c.get("routeKindBackground") === true || matchedRoutes(c).some((route) => route.handler === background);
}
