/**
 * Where the "Open app" button points, per environment.
 *
 * The source of truth is the `APP_URL` var of this Worker (wrangler.toml, one
 * value per environment; `dev:all` passes the dev server's real URL). It is
 * never baked into a static file: the same `index.html` is served by local,
 * preview and production, and only the Worker knows which one it is.
 *
 * When `APP_URL` is missing — a half-configured deploy, or a site on
 * workers.dev set up before the account's address was known — the host the
 * site was reached on gives the answer anyway:
 *
 * - on a domain, the app is the `app.` subdomain of it;
 * - on workers.dev, it is the Worker of the same name without `-website`
 *   (`acme-website-preview.team.workers.dev` → `acme-preview.team.workers.dev`),
 *   which is how `setup:website` names the two.
 *
 * A link that is right by accident beats a link to nowhere.
 */

/** The app's origin for this request: `APP_URL`, else worked out from the site's own host. */
export function resolveAppUrl(appUrl: string | undefined, requestUrl: string): string {
	const configured = (appUrl ?? "").trim().replace(/\/+$/, "");
	if (configured) return /^https?:\/\//.test(configured) ? configured : `https://${configured}`;

	const url = new URL(requestUrl);
	// A local dev site has no app subdomain to point at; the app runs on its own port.
	if (isLocalHost(url.hostname)) return "http://localhost:5173";
	const [worker, ...rest] = url.hostname.split(".");
	const cut = worker.lastIndexOf("-website");
	if (url.hostname.endsWith(".workers.dev") && cut > 0) {
		const app = worker.slice(0, cut) + worker.slice(cut + "-website".length);
		return `${url.protocol}//${[app, ...rest].join(".")}`;
	}
	return `${url.protocol}//app.${url.hostname.replace(/^www\./, "")}`;
}

/**
 * The loopback, however it was typed. `[::1]` matters: a URL's hostname keeps
 * the brackets, and without it a dev server reached over IPv6 — which is what
 * `localhost` resolves to first on macOS — would be redirected to https and
 * fail to connect.
 */
export function isLocalHost(hostname: string): boolean {
	const host = hostname.replace(/^\[|\]$/g, "");
	return host === "localhost" || host === "::1" || /^127\./.test(host) || host.endsWith(".localhost");
}
