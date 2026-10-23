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
 */
export type DeployMode = "manual" | "workers-builds" | "external-ci";

/**
 * How the app is taken out of service for a `breaking` migration or an incident.
 * Both mechanisms live **outside** the Worker, so they still work when the
 * Worker itself is the problem — which is exactly when you need them.
 *
 * - `redirect` — a Single Redirect rule. Available on **every zone plan**,
 *                including Free. Answers 302 to a page you host elsewhere.
 * - `snippet`  — a Snippet returning a real 503 with `Retry-After`. The correct
 *                semantics, but Snippets need a **Pro zone or above**.
 * - `none`     — no maintenance mechanism. Required for `*.workers.dev`, which
 *                is not part of a zone and so has neither.
 */
export type MaintenanceMechanism = "redirect" | "snippet" | "none";

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
	},

	/**
	 * Address that receives a report when a deploy fails. Sent by the Worker
	 * through the app's own email adapter, so it needs no extra credentials in
	 * CI. Empty disables the report; CI still fails loudly on its own.
	 */
	notifyEmail: "",
} as const;

export type DeployConfig = typeof deployConfig;
