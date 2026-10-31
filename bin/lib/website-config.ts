/**
 * Is the product website on, and where does it live?
 *
 * The switch is the presence of `website.config.ts` (written by
 * `npm run setup:website`). Everything that has to behave differently with a
 * website — the dev runner, the deploys, the Playwright config — asks here,
 * rather than guessing from a folder being on disk.
 *
 * Read with a small parser instead of `import`: this is called from the
 * Playwright config and from scripts that must work in a checkout where the
 * file does not exist at all, where a static import would not typecheck and a
 * dynamic one would force every caller to be async.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type WebsiteSettings = {
	dir: string;
	hosts: { production: string; preview: string };
	app: { production: string; preview: string };
};

const CONFIG_FILE = "website.config.ts";

function value(source: string, path: string[]): string {
	// `app: {\n production: "…"` — the key under its section, whichever order they are in.
	const section = path.length > 1 ? new RegExp(`${path[0]}\\s*:\\s*\\{([\\s\\S]*?)\\}`, "m").exec(source)?.[1] ?? "" : source;
	return new RegExp(`${path.at(-1)}\\s*:\\s*"([^"]*)"`, "m").exec(section)?.[1] ?? "";
}

/** The project's website settings, or null when the project has no website. */
export function loadWebsiteConfig(rootDir = process.cwd()): WebsiteSettings | null {
	const file = resolve(rootDir, CONFIG_FILE);
	if (!existsSync(file)) return null;
	const source = readFileSync(file, "utf-8");
	const settings: WebsiteSettings = {
		dir: value(source, ["dir"]) || "website",
		hosts: { production: value(source, ["hosts", "production"]), preview: value(source, ["hosts", "preview"]) },
		app: { production: value(source, ["app", "production"]), preview: value(source, ["app", "preview"]) },
	};
	if (!existsSync(resolve(rootDir, settings.dir, "wrangler.toml"))) {
		throw new Error(`${CONFIG_FILE} points at "${settings.dir}", which has no wrangler.toml. Run setup:website, or delete ${CONFIG_FILE}.`);
	}
	return settings;
}

/** The website's settings, or an explanation of why there are none. */
export function requireWebsiteConfig(rootDir = process.cwd()): WebsiteSettings {
	const settings = loadWebsiteConfig(rootDir);
	if (!settings) throw new Error(`this project has no product website (no ${CONFIG_FILE}). Add one with: npm run setup:website`);
	return settings;
}
