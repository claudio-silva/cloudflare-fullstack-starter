/**
 * Deployment configuration.
 *
 * This file is **committed on purpose**. How a project reaches production is a
 * decision of the project, not of whoever happens to be deploying: if one
 * developer had `manual` in their `.env` and another had `workers-builds`, the
 * same `npm run deploy:production` would do two different things. Secrets stay
 * in `.env.*`; the shape of the pipeline lives here.
 *
 * Read only by the scripts in `bin/`. Nothing here reaches the browser bundle.
 *
 * Every value can still be overridden per environment with a `DEPLOY_*`
 * variable in `.env.<environment>`, for the occasional case where preview and
 * production genuinely differ. See `docs/DEPLOYMENT.md`.
 */

/**
 * - `manual`         — no CI. `deploy:production` builds, deploys, migrates and
 *                      tags from your machine. The default.
 * - `workers-builds` — Cloudflare Workers Builds (GitHub or GitLab.com).
 *                      `deploy:production` tags and promotes; Cloudflare builds.
 * - `external-ci`    — any other CI (self-hosted GitLab, GitHub Actions, …).
 *                      `deploy:production` tags and promotes; your CI builds.
 *
 * `manual` is also the **off switch for CI deploys**: set it, commit, and every
 * CI deploy job ends green at its first step (`bin/ci-deploy-guard.ts`) having
 * done nothing, while `deploy:production` deploys from your machine. Set the
 * previous mode back to turn them on again. See docs/DEPLOYMENT.md.
 */
export type DeployMode = "manual" | "workers-builds" | "external-ci";

/**
 * How the app is taken **out of service in an emergency** — a security problem,
 * a bad deploy, anything where you need traffic to stop now.
 *
 * This lives at the zone level, outside the Worker, which is the point: it
 * still works when the Worker itself is what is broken, and it is one API call
 * rather than a deploy.
 *
 * A *planned* window is a different problem with a different answer: see the
 * `MAINTENANCE` var in `src/worker/middleware/maintenance.ts`. That one keeps
 * the URL, returns a real 503, and lets the client replay the request. The
 * deploy sets it on its own for a `breaking` migration.
 *
 * - `redirect` — a Single Redirect rule. Available on **every zone plan**,
 *                including Free. 302 to a page you host elsewhere.
 * - `none`     — disabled. Required for `*.workers.dev`, which is not part of
 *                a zone and so has no rules.
 */
export type MaintenanceMechanism = "redirect" | "none";

export const deployConfig = {
	mode: "manual" as DeployMode,

	/**
	 * Branches that CI watches, used by `deploy:production` to promote.
	 * Production deploys are driven by a `vX.Y.Z` tag, never by a branch push,
	 * so a merge without a tag deploys nothing. Preview deploys on every push
	 * to its branch and reports its version as `X.Y.Z+preview.<sha>`.
	 */
	branches: {
		preview: "preview",
		production: "release",
	},

	maintenance: {
		mechanism: "none" as MaintenanceMechanism,

		/** Cloudflare zone id of the custom domain. Not needed for `none`. */
		zoneId: "",

		/**
		 * Hostname to take down per environment. Empty means "read the first
		 * route pattern from `[env.<name>]` in wrangler.toml", which is usually
		 * what you want — one source of truth.
		 */
		hostname: {
			preview: "",
			production: "",
		},

		/** Where `redirect` sends visitors. Host it outside this Worker. */
		redirectTo: "",

		/**
		 * Paths that stay reachable while the app is down. The deploy scripts
		 * need `/api/cli/` to run migrations and report failures, so removing it
		 * means a maintenance window you cannot deploy inside of.
		 */
		bypassPaths: ["/api/cli/"],

		/**
		 * Exact paths that stay reachable, as opposed to prefixes. The health
		 * endpoint has to be here: `deploy-production` polls it to confirm the
		 * released version is live, and a window that redirects it makes every
		 * deploy inside one time out. It cannot go in `bypassPaths` — "/api/"
		 * as a prefix would expose the whole API.
		 *
		 * The trade-off: a monitor polling /api/ still sees "healthy" during a
		 * window. It is reporting the Worker, not the app, and anything hitting
		 * the app itself gets the redirect.
		 */
		bypassExactPaths: ["/api/"],
	},

	/**
	 * Address that receives a report when a deploy fails. Sent by the Worker
	 * through the app's own email adapter, so it needs no extra credentials in
	 * CI. Empty disables the report; CI still fails loudly on its own.
	 */
	notifyEmail: "",
} as const;

export type DeployConfig = typeof deployConfig;
