/**
 * The product website's Worker — a **separate** Cloudflare Worker from the app.
 *
 * It has no D1, no R2, no Durable Objects, no Better Auth and none of the app's
 * secrets, on purpose: Cloudflare binds data and secrets to the *script name*,
 * so the only way the public apex cannot reach the app's database is for it to
 * be another script. See docs/WEBSITE.md.
 *
 * It does three things; everything else is a static file from `public/`:
 *   - redirects http:// to https:// (not locally);
 *   - rewrites `<a data-app-link>` to the app's URL for this environment, so
 *     "Open app" is right in local, preview and production without a build;
 *   - serves `/maintenance.html`, the page the emergency redirect points at
 *     (deploy.config.ts → maintenance), which is why it must not depend on the
 *     app being up.
 */
import { resolveAppUrl, isLocalHost } from "./app-url";

type Env = {
	ASSETS: Fetcher;
	APP_URL?: string;
	ENVIRONMENT?: string;
};

function httpsRedirect(request: Request): Response | null {
	const url = new URL(request.url);
	if (url.protocol === "https:" || isLocalHost(url.hostname)) return null;
	url.protocol = "https:";
	return Response.redirect(url.toString(), 301);
}

/**
 * Point every `<a data-app-link>` at the app. The theme is added in the
 * browser (public/js/site.js) at click time, so the link still works — just
 * without carrying the theme — when JavaScript does not run.
 */
function withAppLinks(response: Response, appUrl: string): Response {
	return new HTMLRewriter()
		.on("a[data-app-link]", {
			element(element) {
				const path = element.getAttribute("data-app-link") || "/";
				element.setAttribute("href", `${appUrl}${path.startsWith("/") ? path : `/${path}`}`);
			},
		})
		.transform(response);
}

const isHtml = (response: Response) => (response.headers.get("content-type") ?? "").includes("text/html");

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const redirect = httpsRedirect(request);
		if (redirect) return redirect;

		const response = await env.ASSETS.fetch(request);
		if (!isHtml(response)) return response;
		return withAppLinks(response, resolveAppUrl(env.APP_URL, request.url));
	},
};
