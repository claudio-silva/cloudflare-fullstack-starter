/**
 * The decisions of `npm run setup:website`, kept apart from the file writing so
 * they can be tested: which hostnames each environment gets, what the website
 * Worker's wrangler.toml says, which scripts the project gains.
 *
 * See docs/WEBSITE.md for what the feature is and why the website is a Worker
 * of its own.
 */

export type WebsiteHosts = {
	/** The product website: the apex in production, `preview-<domain>` in preview. */
	site: { production: string; preview: string };
	/** The app, which moves to a subdomain of each of those. */
	app: { production: string; preview: string };
};

export type WebsiteOptions = {
	domain: string;
	/** Subdomain the app moves to. Default `app`. */
	subdomain: string;
	/** Folder the website lives in. Default `website`. */
	dir: string;
	/** Preview hostname of the app. Default `app.preview-<domain>`. */
	previewAppHost: string;
	/** Preview hostname of the website. Default `preview-<domain>`. */
	previewHost: string;
};

/** The hostname in what someone typed: a URL, a port, a trailing dot, capitals. */
function hostOf(value: string): string {
	return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/?#:].*$/, "").replace(/\.$/, "");
}

/**
 * The domain to **suggest** for the website, derived from the app's base URL:
 * `https://app.acme.io/` → `acme.io`. That URL is what a project already has,
 * and it usually carries the very subdomain the website must not inherit.
 *
 * Used only to work out a default. A domain someone states is taken as it is:
 * `test.acme.io` is a perfectly good apex for a website, and guessing that its
 * first label was a subdomain would make that impossible to ask for.
 */
export function rootDomain(baseUrl: string): string {
	const labels = hostOf(baseUrl).split(".").filter(Boolean);
	if (labels.length > 2 && ["app", "www", "preview", "staging", "dev", "test"].includes(labels[0])) return labels.slice(1).join(".");
	return labels.join(".");
}

export function resolveOptions(overrides: Partial<WebsiteOptions> & { domain: string }): WebsiteOptions {
	const domain = hostOf(overrides.domain);
	if (!domain || !domain.includes(".")) throw new Error(`"${overrides.domain}" is not a domain (example: acme.io)`);
	const subdomain = overrides.subdomain || "app";
	const previewHost = overrides.previewHost || `preview-${domain}`;
	return {
		domain,
		subdomain,
		dir: overrides.dir || "website",
		previewHost,
		previewAppHost: overrides.previewAppHost || `${subdomain}.${previewHost}`,
	};
}

export function websiteHosts(options: WebsiteOptions): WebsiteHosts {
	return {
		site: { production: options.domain, preview: options.previewHost },
		app: { production: `${options.subdomain}.${options.domain}`, preview: options.previewAppHost },
	};
}

/**
 * The website Worker's wrangler.toml.
 *
 * Generated once and then owned by the project: `setup:website` never
 * overwrites it, so a second run cannot undo a binding someone added.
 */
export function websiteWranglerToml(o: {
	workerName: string;
	compatibilityDate: string;
	hosts: WebsiteHosts;
}): string {
	const block = (env: "preview" | "production") => `
[env.${env}]
name = "${o.workerName}-${env}"
workers_dev = true
routes = [{ pattern = "${o.hosts.site[env]}", custom_domain = true }]

[env.${env}.vars]
APP_URL = "https://${o.hosts.app[env]}"
ENVIRONMENT = "${env}"
`;

	return `# The product website — a SEPARATE Cloudflare Worker from the app.
#
# It has no D1, no R2, no Durable Objects, no Better Auth and none of the app's
# secrets, and it must stay that way: Cloudflare binds data and secrets to the
# script name, so another script is the only real isolation there is. The app's
# own config is ../wrangler.toml. See docs/WEBSITE.md.
name = "${o.workerName}"
main = "./src/worker.ts"
compatibility_date = "${o.compatibilityDate}"
# Keep the workers.dev address working after a custom domain is attached: it is
# how you reach the site when its domain is the thing that is broken.
workers_dev = true

[observability]
enabled = true

[assets]
directory = "./public"
binding = "ASSETS"
# A marketing site, not an SPA: an unknown path is a 404, not index.html.
not_found_handling = "none"
# The Worker answers first, so it can put the environment's app URL into the
# page (src/worker.ts). Without this the assets are served straight out.
run_worker_first = true

[vars]
# Where "Open app" points. Overridden per environment below, and by
# \`dev:all\`, which passes the dev server's real port.
APP_URL = "http://localhost:5173"
ENVIRONMENT = "local"
${block("preview")}${block("production")}`;
}

/** `website.config.ts`: the one place every other script learns the feature is on. */
export function websiteConfigFile(options: WebsiteOptions, hosts: WebsiteHosts): string {
	return `/**
 * The product website is **on** for this project.
 *
 * The presence of this file is the switch: \`bin/\` scripts, the Playwright
 * config and the typecheck read it through \`bin/lib/website-config.ts\`, and a
 * project without it behaves exactly as a project without a website — which is
 * why the feature adds nothing anywhere else. Written by
 * \`npm run setup:website\` (docs/WEBSITE.md); delete the file and the
 * \`${options.dir}/\` folder to turn it off again.
 *
 * Committed on purpose, like deploy.config.ts: where a project's website lives
 * is a fact about the project, not about whoever is deploying it.
 */
export const websiteConfig = {
	/** Folder holding the website Worker and its static files. */
	dir: "${options.dir}",

	/** Hostnames it is served on. Attach them with \`npm run setup:domain\`. */
	hosts: {
		production: "${hosts.site.production}",
		preview: "${hosts.site.preview}",
	},

	/**
	 * Where "Open app" goes. Kept in step with APP_URL in
	 * \`${options.dir}/wrangler.toml\`, which is what the Worker actually reads.
	 */
	app: {
		production: "https://${hosts.app.production}",
		preview: "https://${hosts.app.preview}",
	},
} as const;

export type WebsiteConfig = typeof websiteConfig;
`;
}

/** The scripts a project gains. `dir` is interpolated so a renamed folder still works. */
export function websiteScripts(dir: string): Record<string, string> {
	return {
		"dev:website": `tsx bin/dev-all.ts --website-only`,
		"dev:all": `tsx bin/dev-all.ts`,
		"check:website": `wrangler deploy --dry-run --config ${dir}/wrangler.toml --env production`,
		"deploy:website:preview": `tsx bin/deploy-website.ts --env preview`,
		"deploy:website:production": `tsx bin/deploy-production.ts --website-only`,
		"deploy:all:preview": `npm run deploy:preview && npm run deploy:website:preview`,
		"deploy:all:production": `tsx bin/deploy-production.ts --with-website`,
	};
}

/**
 * package.json with the website scripts, placed next to the ones they belong
 * with rather than at the end, and `check` extended to cover the site. Returns
 * the same object when everything is already there.
 */
export function withWebsiteScripts(pkg: Record<string, unknown>, dir: string): { pkg: Record<string, unknown>; added: string[] } {
	const scripts = { ...((pkg.scripts ?? {}) as Record<string, string>) };
	const wanted = websiteScripts(dir);
	const added: string[] = [];

	for (const [name, command] of Object.entries(wanted)) {
		if (scripts[name] === undefined) {
			scripts[name] = command;
			added.push(name);
		}
	}
	// `check` is the "would this deploy?" command; it has to ask about both Workers.
	if (typeof scripts.check === "string" && !scripts.check.includes("check:website")) {
		scripts.check = `${scripts.check} && npm run check:website`;
		added.push("check");
	}

	// Keep a stable, readable order: the website scripts right after `check`.
	const order = Object.keys(scripts).filter((k) => !(k in wanted));
	const at = order.indexOf("check");
	order.splice(at === -1 ? order.length : at + 1, 0, ...Object.keys(wanted));
	return { pkg: { ...pkg, scripts: Object.fromEntries(order.map((k) => [k, scripts[k]])) }, added };
}

/** paseo.json with the website offered as a second dev service beside the app's. */
export function withPaseoWebsiteService(source: string): string | null {
	const json = JSON.parse(source) as { scripts?: Record<string, unknown> };
	if (json.scripts?.website) return null;
	json.scripts = { ...json.scripts, website: { type: "service", command: "bin/worktree-website" } };
	return `${JSON.stringify(json, null, 2)}\n`;
}
