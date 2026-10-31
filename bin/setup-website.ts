#!/usr/bin/env tsx
/**
 * Add a product website to this project: a marketing site on the apex domain,
 * with the app moved to `app.<domain>`.
 *
 * The site is a Cloudflare Worker of its own, with its own folder, its own
 * wrangler.toml and no binding, secret or route of the app's. What this script
 * does is entirely local:
 *
 *   1. scaffolds the site in the chosen folder (templates/website/);
 *   2. writes its wrangler.toml, with the apex and preview routes;
 *   3. moves the app's routes to `app.*` in wrangler.toml;
 *   4. points APP_BASE_URL / CLI_API_URL_* and src/config.ts at the app's new
 *      hostnames, in .env.<env> and in the env/ templates;
 *   5. adds the website scripts to package.json and the dev service to paseo.json;
 *   6. records the feature in website.config.ts, which is what every other
 *      script reads.
 *
 * **Nothing remote happens**: no deploy, no domain attached, no secret synced.
 * The hostnames are attached afterwards with `npm run setup:domain`, which is
 * also where a project already live on the apex has to be careful — see the
 * cutover procedure in docs/WEBSITE.md.
 *
 * Safe to run again: every step checks first, and a file the project already
 * has is never overwritten.
 *
 * It **asks** for every value it was not given, offering a default that Enter
 * accepts. For automation there are two ways out of that: pass every value as
 * an option, or pass `--defaults` and have the defaults taken for whatever is
 * missing. Somewhere with no terminal (CI, a subprocess) behaves as
 * `--defaults` on its own, because there is nobody to ask.
 *
 * Usage: npm run setup:website -- [--domain acme.io] [--subdomain app] [--dir website]
 *                                 [--preview-host preview-acme.io] [--preview-app-host app.preview-acme.io]
 *                                 [--defaults] [--yes] [--dry-run]
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { withCustomDomainRoute } from "./lib/custom-domain";
import { fillEnv } from "./lib/setup-ci";
import {
	resolveOptions,
	rootDomain,
	websiteConfigFile,
	websiteHosts,
	websiteWranglerToml,
	withPaseoWebsiteService,
	withWebsiteScripts,
	type WebsiteHosts,
	type WebsiteOptions,
} from "./lib/website";

const USAGE = `Usage: npm run setup:website -- [options]

  --domain <domain>          Domain the website is served on   (default: the project's own)
  --subdomain <label>        Subdomain the app moves to        (default: app)
  --dir <folder>             Folder holding the website        (default: website)
  --preview-host <host>      The website, in preview           (default: preview-<domain>)
  --preview-app-host <host>  The app, in preview               (default: <subdomain>.<preview host>)
  --defaults                 Take the default for every option not given; ask nothing
  --yes, -y                  Do not ask for confirmation
  --dry-run                  Show the plan; write nothing
  --help, -h

Without --defaults it asks for each value, offering its default; Enter accepts it.`;

const TEMPLATE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "templates", "website");
const LOGOS = ["logo-light.svg", "logo-dark.svg"];

// Package-manager agnostic, like bin/init.ts: the next steps are printed for
// whichever package manager was used to run this.
const packageManager = (process.env.npm_config_user_agent ?? "npm").split("/")[0];
const run = (script: string, args = "") => `${packageManager} run ${script}${args ? ` -- ${args}` : ""}`;

type Flags = {
	domain?: string;
	subdomain?: string;
	dir?: string;
	previewHost?: string;
	previewAppHost?: string;
	defaults: boolean;
	dryRun: boolean;
	yes: boolean;
	help: boolean;
};

function parseArgs(argv: string[]): Flags {
	const flags: Flags = {
		defaults: argv.includes("--defaults"),
		dryRun: argv.includes("--dry-run"),
		yes: argv.includes("--yes") || argv.includes("-y"),
		help: argv.includes("--help") || argv.includes("-h"),
	};
	const read = (name: string) => {
		const i = argv.indexOf(name);
		return i === -1 ? undefined : argv[i + 1];
	};
	flags.domain = read("--domain");
	flags.subdomain = read("--subdomain");
	flags.dir = read("--dir");
	flags.previewHost = read("--preview-host");
	flags.previewAppHost = read("--preview-app-host");
	return flags;
}

function die(message: string): never {
	console.error(`\nsetup:website: ${message}`);
	process.exit(1);
}

// --- Reporting ------------------------------------------------------------

let dryRun = false;
let changes = 0;
const ok = (message: string) => console.log(`  ✓ ${message}`);
const change = (message: string) => {
	changes++;
	console.log(`  ${dryRun ? "would" : "→"} ${message}`);
};
const warn = (message: string) => console.log(`  ! ${message}`);

function write(file: string, content: string): void {
	if (dryRun) return;
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, content, "utf-8");
}

// --- Steps ----------------------------------------------------------------

/** Copy the scaffold, substituting the app's name; a file the project has is left alone. */
function scaffold(root: string, dir: string, appName: string): void {
	const target = resolve(root, dir);
	const copied: string[] = [];
	const kept: string[] = [];

	const walk = (from: string, to: string): void => {
		for (const entry of readdirSync(from)) {
			const source = join(from, entry);
			const destination = join(to, entry);
			if (statSync(source).isDirectory()) {
				walk(source, destination);
				continue;
			}
			if (existsSync(destination)) {
				kept.push(relative(root, destination));
				continue;
			}
			copied.push(relative(root, destination));
			if (dryRun) continue;
			mkdirSync(dirname(destination), { recursive: true });
			if (/\.(html|css|js|ts)$/.test(entry)) {
				writeFileSync(destination, readFileSync(source, "utf-8").replaceAll("__APP_NAME__", appName), "utf-8");
			} else {
				copyFileSync(source, destination);
			}
		}
	};
	walk(TEMPLATE_DIR, target);

	if (copied.length) change(`create ${dir}/ (${copied.length} files: the page, its styles, the Worker)`);
	if (kept.length) ok(`${kept.length} file(s) of ${dir}/ already there, left as they are`);

	// The site shows the app's logo. Copied rather than linked: the two Workers
	// deploy separately, and the site must not depend on the app's build output.
	const assets = join(target, "public", "assets");
	for (const logo of LOGOS) {
		const destination = join(assets, logo);
		if (existsSync(destination)) {
			ok(`${dir}/public/assets/${logo}`);
			continue;
		}
		const source = resolve(root, "src", "react-app", "assets", logo);
		if (!existsSync(source)) {
			warn(`no src/react-app/assets/${logo} to copy; put a ${logo} in ${dir}/public/assets/ by hand`);
			continue;
		}
		change(`copy ${logo} from the app into ${dir}/public/assets/`);
		if (!dryRun) {
			mkdirSync(assets, { recursive: true });
			copyFileSync(source, destination);
		}
	}
}

function websiteWrangler(root: string, options: WebsiteOptions, hosts: WebsiteHosts, workerName: string, compatibilityDate: string): void {
	const file = resolve(root, options.dir, "wrangler.toml");
	if (existsSync(file)) return ok(`${options.dir}/wrangler.toml (kept: it is the project's now)`);
	change(`write ${options.dir}/wrangler.toml — Worker ${workerName}, ${hosts.site.production} and ${hosts.site.preview}`);
	write(file, websiteWranglerToml({ workerName, compatibilityDate, hosts }));
}

/** Move the app's routes to `app.*`. A project that already has routes keeps them. */
function appRoutes(root: string, hosts: WebsiteHosts): void {
	const file = resolve(root, "wrangler.toml");
	let source = readFileSync(file, "utf-8");
	for (const env of ["preview", "production"] as const) {
		const hostname = hosts.app[env];
		const block = source.slice(source.indexOf(`[env.${env}]`), nextSection(source, `[env.${env}]`));
		const hadRoutes = /routes\s*=/.test(block);
		const updated = withCustomDomainRoute(source, env, hostname);
		if (!updated) {
			ok(`wrangler.toml: [env.${env}] already serves ${hostname}`);
			continue;
		}
		source = updated;
		change(`serve the ${env} app on ${hostname} (wrangler.toml, [env.${env}] routes)`);
		if (hadRoutes) {
			warn(`[env.${env}] had routes already; ${hostname} is added beside them. Releasing a hostname the app no longer serves is a manual step — docs/WEBSITE.md, "Moving a live project".`);
		}
	}
	write(file, source);
}

function nextSection(source: string, header: string): number {
	const start = source.indexOf(header);
	if (start === -1) return source.length;
	const rest = source.slice(start + header.length);
	const next = rest.search(/^\s*\[/m);
	return next === -1 ? source.length : start + header.length + next;
}

/**
 * Is this URL ours to change? Anything the templates ship, anything empty, and
 * the apex the app is moving off. A hostname someone chose deliberately is
 * left alone with a warning: that is a live URL, and moving it is a cutover,
 * not a setup step.
 */
function movable(current: string, options: WebsiteOptions, hosts: WebsiteHosts, env: "preview" | "production"): boolean {
	if (!current || /(^|[./])example\.com\b/.test(current)) return true;
	const host = current.replace(/^https?:\/\//, "").replace(/[/?#:].*$/, "").toLowerCase();
	return host === hosts.site[env] || host === `www.${hosts.site[env]}` || host === hosts.app[env] || host === `preview.${options.domain}`;
}

function appUrls(root: string, options: WebsiteOptions, hosts: WebsiteHosts): void {
	for (const env of ["preview", "production"] as const) {
		const url = `https://${hosts.app[env]}`;
		const keys = { APP_BASE_URL: url, [`CLI_API_URL_${env.toUpperCase()}`]: url };
		for (const file of [resolve(root, `.env.${env}`), resolve(root, "env", `${env}.env.template`)]) {
			if (!existsSync(file)) continue;
			const content = readFileSync(file, "utf-8");
			const current = /^APP_BASE_URL=(.*)$/m.exec(content)?.[1] ?? "";
			if (!movable(current.trim(), options, hosts, env)) {
				warn(`${relative(root, file)} keeps APP_BASE_URL=${current.trim()} (a hostname you chose). Point it at ${url} when you do the cutover — docs/WEBSITE.md.`);
				continue;
			}
			const filled = fillEnv(content, keys, { overwrite: true });
			if (!filled.changed.length) {
				ok(`${relative(root, file)} already uses ${url}`);
				continue;
			}
			change(`set ${filled.changed.join(", ")} to ${url} in ${relative(root, file)}`);
			write(file, filled.content);
		}
	}

	// The fallbacks used when APP_BASE_URL is unset must agree with it.
	const file = resolve(root, "src", "config.ts");
	const source = readFileSync(file, "utf-8");
	const updated = source
		.replace(/(baseUrls:\s*\{[\s\S]*?preview:\s*)"([^"]*)"/, (whole, lead: string, current: string) =>
			movable(current, options, hosts, "preview") ? `${lead}"https://${hosts.app.preview}"` : whole,
		)
		.replace(/(baseUrls:\s*\{[\s\S]*?production:\s*)"([^"]*)"/, (whole, lead: string, current: string) =>
			movable(current, options, hosts, "production") ? `${lead}"https://${hosts.app.production}"` : whole,
		);
	if (updated === source) return ok("src/config.ts baseUrls already point at the app's hostnames");
	change(`point config.baseUrls at https://${hosts.app.preview} and https://${hosts.app.production} (src/config.ts)`);
	write(file, updated);
}

function packageScripts(root: string, dir: string): void {
	const file = resolve(root, "package.json");
	const pkg = JSON.parse(readFileSync(file, "utf-8")) as Record<string, unknown>;
	const { pkg: updated, added } = withWebsiteScripts(pkg, dir);
	if (!added.length) return ok("package.json already has the website scripts");
	change(`add the scripts ${added.join(", ")} to package.json`);
	write(file, `${JSON.stringify(updated, null, "\t")}\n`);
}

function paseoService(root: string): void {
	const file = resolve(root, "paseo.json");
	if (!existsSync(file)) return;
	const updated = withPaseoWebsiteService(readFileSync(file, "utf-8"));
	if (!updated) return ok("paseo.json already offers the website service");
	change("add the website dev service to paseo.json (worktrees run it beside the app's)");
	write(file, updated);
}

function record(root: string, options: WebsiteOptions, hosts: WebsiteHosts): void {
	const file = resolve(root, "website.config.ts");
	if (existsSync(file)) return ok("website.config.ts (kept: the website is already registered)");
	change("write website.config.ts — the switch every other script reads");
	write(file, websiteConfigFile(options, hosts));
}

// --- Main -----------------------------------------------------------------

function readValue(source: string, key: string): string {
	return new RegExp(`${key}:\\s*"([^"]*)"`).exec(source)?.[1] ?? "";
}

/**
 * Ask for each value that was not given on the command line, offering the
 * default Enter accepts. Each answer feeds the next default — the app's
 * preview hostname is built from the subdomain and the preview hostname just
 * chosen — which is why this is a sequence and not a form.
 */
async function askOptions(flags: Flags, defaultDomain: string): Promise<Partial<WebsiteOptions> & { domain: string }> {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	const ask = async (question: string, fallback: string): Promise<string> => {
		const answer = await new Promise<string>((done) => rl.question(`  ${question} [${fallback}]: `, done));
		return answer.trim() || fallback;
	};

	try {
		console.log("Answer or press Enter to take the default.\n");
		let domain = flags.domain ?? "";
		while (!domain) {
			const answer = await ask("Domain the website is served on", defaultDomain);
			try {
				resolveOptions({ domain: answer });
				domain = answer;
			} catch (error) {
				console.log(`  ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		const subdomain = flags.subdomain ?? (await ask("Subdomain the app moves to", "app"));
		const dir = flags.dir ?? (await ask("Folder holding the website", "website"));
		const previewHost = flags.previewHost ?? (await ask("The website's preview hostname", `preview-${domain}`));
		const previewAppHost = flags.previewAppHost ?? (await ask("The app's preview hostname", `${subdomain}.${previewHost}`));
		console.log("");
		return { domain, subdomain, dir, previewHost, previewAppHost };
	} finally {
		rl.close();
	}
}

async function confirm(question: string, yes: boolean): Promise<boolean> {
	if (yes || !process.stdin.isTTY) return true;
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	const answer = await new Promise<string>((done) => rl.question(`${question} [Y/n] `, done));
	rl.close();
	return answer.trim().toLowerCase() !== "n";
}

async function main(): Promise<void> {
	const flags = parseArgs(process.argv.slice(2));
	if (flags.help) return console.log(USAGE);
	dryRun = flags.dryRun;

	const root = process.cwd();
	if (!existsSync(resolve(root, "wrangler.toml")) || !existsSync(resolve(root, "package.json"))) die("run it from the project root");

	const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf-8")) as { name?: string };
	const configSource = readFileSync(resolve(root, "src", "config.ts"), "utf-8");
	const appName = readValue(configSource, "appName") || "My App";
	const wrangler = readFileSync(resolve(root, "wrangler.toml"), "utf-8");
	const compatibilityDate = /compatibility_date\s*=\s*"([^"]+)"/.exec(wrangler)?.[1] ?? "2025-04-01";
	const workerName = `${/^name\s*=\s*"([^"]+)"/m.exec(wrangler)?.[1] ?? pkg.name ?? "app"}-website`;

	// A domain given on the command line is used as it is; one derived from the
	// app's own URL has its subdomain taken off first (`https://app.acme.io` →
	// `acme.io`), which is a guess, and so only ever a default.
	const defaultDomain = rootDomain(readValue(configSource.slice(configSource.indexOf("baseUrls")), "production"));
	// Nobody to ask: --defaults, or no terminal at all (CI, a subprocess).
	const asking = !flags.defaults && Boolean(process.stdin.isTTY);
	if (!flags.domain && !defaultDomain && !asking) die("no domain: pass --domain acme.io, or run `npm run init` first so the project has one");

	const answers = asking
		? await askOptions(flags, defaultDomain)
		: { domain: flags.domain ?? defaultDomain, subdomain: flags.subdomain, dir: flags.dir, previewHost: flags.previewHost, previewAppHost: flags.previewAppHost };

	let options: WebsiteOptions;
	try {
		options = resolveOptions(answers);
	} catch (error) {
		die(error instanceof Error ? error.message : String(error));
	}
	const hosts = websiteHosts(options);

	console.log(`${dryRun ? "Dry run: nothing is written.\n" : ""}A product website for ${appName}:`);
	console.log(`  website    https://${hosts.site.production}   (preview: https://${hosts.site.preview})`);
	console.log(`  app        https://${hosts.app.production}   (preview: https://${hosts.app.preview})`);
	console.log(`  folder     ${options.dir}/   ·  Worker ${workerName}\n`);
	if (!dryRun && !(await confirm("This changes local files only — nothing is deployed. Go ahead?", flags.yes))) die("aborted");

	scaffold(root, options.dir, appName);
	websiteWrangler(root, options, hosts, workerName, compatibilityDate);
	appRoutes(root, hosts);
	appUrls(root, options, hosts);
	packageScripts(root, options.dir);
	paseoService(root);
	record(root, options, hosts);

	if (dryRun) return console.log(`\n(dry run — ${changes} change(s) would be made, nothing was written)`);
	if (changes === 0) return console.log("\nNothing to do: this project already has its website.");

	console.log(`\n✅ The website is set up in ${options.dir}/.\n`);
	console.log("Next steps:");
	console.log(`  1. See it, beside the app:        ${run("dev:all")}`);
	console.log(`  2. Check it would deploy:          ${run("check:website")}`);
	console.log(`  3. Deploy the app on its new URL:  ${run("deploy:preview")}  (then ${run("setup:domain", `${hosts.app.preview} --env preview`)})`);
	console.log(`  4. Deploy the website:             ${run("deploy:website:preview")}  (then ${run("setup:domain", `${hosts.site.preview} --env preview --website`)})`);
	console.log(`  5. The same for production:        ${run("deploy:production")}, ${run("deploy:website:production")}`);
	console.log(`\n  • An app already live on https://${hosts.site.production} needs the cutover procedure first: docs/WEBSITE.md.`);
	console.log(`  • For the emergency maintenance page, set in deploy.config.ts:`);
	console.log(`        maintenance.mechanism = "redirect"`);
	console.log(`        maintenance.redirectTo = "https://${hosts.site.production}/maintenance.html"`);
}

main().catch((error: unknown) => die(error instanceof Error ? error.message : String(error)));
