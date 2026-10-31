/**
 * Where the "Open app" button points, per environment.
 *
 * The source of truth is the `APP_URL` var of this Worker (wrangler.toml, one
 * value per environment; `dev:all` passes the dev server's real URL). It is
 * never baked into a static file: the same `index.html` is served by local,
 * preview and production, and only the Worker knows which one it is.
 *
 * When `APP_URL` is missing — a half-configured deploy — the host the site was
 * reached on gives the answer anyway: the app is the `app.` subdomain of it.
 * A link that is right by accident beats a link to nowhere.
 */

/** The app's origin for this request: `APP_URL`, else `app.<site host>`. */
export function resolveAppUrl(appUrl: string | undefined, requestUrl: string): string {
	const configured = (appUrl ?? "").trim().replace(/\/+$/, "");
	if (configured) return /^https?:\/\//.test(configured) ? configured : `https://${configured}`;

	const url = new URL(requestUrl);
	// A local dev site has no app subdomain to point at; the app runs on its own port.
	if (isLocalHost(url.hostname)) return "http://localhost:5173";
	return `${url.protocol}//app.${url.hostname.replace(/^www\./, "")}`;
}

export function isLocalHost(hostname: string): boolean {
	return hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".localhost");
}
