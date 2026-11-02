import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appPortFrom } from "../../bin/dev-all";
import { loadWebsiteConfig } from "../../bin/lib/website-config";
import {
	isNoDomain,
	resolveOptions,
	rootDomain,
	websiteHosts,
	websiteWranglerToml,
	withPaseoWebsiteService,
	withWebsiteScripts,
	workersDevHosts,
	workersSubdomainOf,
} from "../../bin/lib/website";
import { resolveAppUrl } from "../../templates/website/src/app-url";
// The very file the browser loads, imported as it is: there is no second copy
// of these rules to test instead.
import { effectiveTheme, resolveTheme, withTheme } from "../../templates/website/public/js/app-link.js";

const REPO = resolve(import.meta.dirname, "..", "..");

describe("hostnames", () => {
	it("suggests a domain from an app's base URL", () => {
		expect(rootDomain("https://app.acme.io/")).toBe("acme.io");
		expect(rootDomain("https://preview.acme.io")).toBe("acme.io");
		expect(rootDomain("acme.io")).toBe("acme.io");
		expect(rootDomain("https://my.app.co.uk")).toBe("my.app.co.uk");
	});

	it("takes a domain it is given as it is, subdomain and all", () => {
		// Guessing here would make a website on test.acme.io impossible to ask for.
		const hosts = websiteHosts(resolveOptions({ domain: "test.acme.io" }));
		expect(hosts.site.production).toBe("test.acme.io");
		expect(hosts.app.production).toBe("app.test.acme.io");
		expect(hosts.site.preview).toBe("preview-test.acme.io");
		expect(hosts.app.preview).toBe("app.preview-test.acme.io");
		expect(websiteHosts(resolveOptions({ domain: "https://DEV.acme.io:8080/x" })).site.production).toBe("dev.acme.io");
	});

	it("puts the site on the apex and the app on a subdomain of it", () => {
		// What the setup does with a project whose app lives on https://app.acme.io.
		const hosts = websiteHosts(resolveOptions({ domain: rootDomain("https://app.acme.io") }));
		expect(hosts).toEqual({
			site: { production: "acme.io", preview: "preview-acme.io" },
			app: { production: "app.acme.io", preview: "app.preview-acme.io" },
		});
	});

	it("takes every host from the overrides when they are given", () => {
		const options = resolveOptions({
			domain: "acme.io",
			subdomain: "my",
			dir: "marketing",
			previewHost: "staging.acme.io",
			previewAppHost: "my-staging.acme.io",
		});
		expect(options.dir).toBe("marketing");
		expect(websiteHosts(options)).toEqual({
			site: { production: "acme.io", preview: "staging.acme.io" },
			app: { production: "my.acme.io", preview: "my-staging.acme.io" },
		});
	});

	it("follows the subdomain into the preview host", () => {
		expect(websiteHosts(resolveOptions({ domain: "acme.io", subdomain: "console" })).app.preview).toBe("console.preview-acme.io");
	});

	it("refuses what is not a domain", () => {
		expect(() => resolveOptions({ domain: "localhost" })).toThrow(/not a domain/);
	});
});

describe("the website Worker's wrangler.toml", () => {
	const toml = websiteWranglerToml({
		workerName: "acme-website",
		compatibilityDate: "2025-04-01",
		hosts: websiteHosts(resolveOptions({ domain: "acme.io" })),
	});

	it("names one Worker per environment, on its own hostname", () => {
		expect(toml).toContain('name = "acme-website"');
		expect(toml).toContain('name = "acme-website-preview"');
		expect(toml).toContain('routes = [{ pattern = "acme.io", custom_domain = true }]');
		expect(toml).toContain('routes = [{ pattern = "preview-acme.io", custom_domain = true }]');
	});

	it("points each environment at its own app", () => {
		expect(toml).toContain('APP_URL = "https://app.preview-acme.io"');
		expect(toml).toContain('APP_URL = "https://app.acme.io"');
	});

	it("carries nothing of the app's", () => {
		expect(toml).not.toMatch(/d1_databases|name = "EMAIL"|AUTH_RATE_LIMITER|BETTER_AUTH|CLI_API_KEY/);
	});

	it("has an email binding and a rate limit of its own, for the contact form", () => {
		const own = websiteWranglerToml({
			workerName: "acme-website",
			compatibilityDate: "2025-04-01",
			hosts: websiteHosts(resolveOptions({ domain: "acme.io" })),
			contact: { from: "hello@acme.io", to: "team@acme.io" },
		});
		for (const env of ["preview", "production"]) {
			expect(own).toContain(`[[env.${env}.send_email]]\nname = "CONTACT_EMAIL"\nallowed_sender_addresses = ["hello@acme.io"]`);
			expect(own).toContain(`[[env.${env}.ratelimits]]\nname = "CONTACT_RATE_LIMITER"`);
		}
		expect(own).toContain('CONTACT_TO = "team@acme.io"');
		expect(own).toContain('CONTACT_FROM = "hello@acme.io"');
		// Locally neither: the form writes messages to the terminal.
		expect(own.slice(0, own.indexOf("[env.preview]"))).not.toMatch(/^\[\[(send_email|ratelimits)\]\]/m);
	});
});

describe("a website with no domain", () => {
	const hosts = workersDevHosts({
		websiteWorker: "acme-website",
		appWorkers: { production: "acme-production", preview: "acme-preview" },
		accountSubdomain: "team",
	});

	it("knows a domain from what is not one", () => {
		expect(isNoDomain("https://app.example.com")).toBe(true);
		expect(isNoDomain("https://acme-production.team.workers.dev")).toBe(true);
		expect(isNoDomain("")).toBe(true);
		expect(isNoDomain("https://app.acme.io")).toBe(false);
		expect(workersSubdomainOf("https://acme-production.team.workers.dev/")).toBe("team");
		expect(workersSubdomainOf("https://app.acme.io")).toBeNull();
	});

	it("puts each Worker on its own workers.dev address", () => {
		expect(hosts).toEqual({
			site: { production: "acme-website-production.team.workers.dev", preview: "acme-website-preview.team.workers.dev" },
			app: { production: "acme-production.team.workers.dev", preview: "acme-preview.team.workers.dev" },
		});
	});

	it("routes nothing, and points at the app's own address", () => {
		const toml = websiteWranglerToml({ workerName: "acme-website", compatibilityDate: "2025-04-01", hosts, mode: "workers-dev" });
		expect(toml).not.toContain("routes");
		expect(toml).toContain("workers_dev = true");
		expect(toml).toContain('APP_URL = "https://acme-production.team.workers.dev"');
		expect(toml).toContain('APP_URL = "https://acme-preview.team.workers.dev"');
	});

	it("leaves the app's address to the Worker when the account's is not known", () => {
		const unknown = workersDevHosts({ websiteWorker: "acme-website", appWorkers: { production: "acme-production", preview: "acme-preview" }, accountSubdomain: null });
		const toml = websiteWranglerToml({ workerName: "acme-website", compatibilityDate: "2025-04-01", hosts: unknown, mode: "workers-dev" });
		expect(toml).not.toMatch(/\[env\.(preview|production)\.vars\]\nAPP_URL/);
		expect(toml).toContain("No APP_URL");
	});
});

describe("the app's URL, as the site's Worker sees it", () => {
	it("is the environment's APP_URL when there is one", () => {
		expect(resolveAppUrl("https://app.acme.io", "https://acme.io/")).toBe("https://app.acme.io");
		expect(resolveAppUrl("https://app.acme.io/", "https://acme.io/")).toBe("https://app.acme.io");
		expect(resolveAppUrl("app.acme.io", "https://acme.io/")).toBe("https://app.acme.io");
	});

	it("takes the dev server's port, whatever it is", () => {
		expect(resolveAppUrl("http://localhost:49231", "http://localhost:8788/")).toBe("http://localhost:49231");
	});

	it("falls back to the app subdomain of the host it was reached on", () => {
		expect(resolveAppUrl(undefined, "https://preview-acme.io/pricing")).toBe("https://app.preview-acme.io");
		expect(resolveAppUrl("", "https://www.acme.io/")).toBe("https://app.acme.io");
		expect(resolveAppUrl(undefined, "http://localhost:8788/")).toBe("http://localhost:5173");
		// The loopback however it was typed: `localhost` resolves to ::1 first on macOS.
		expect(resolveAppUrl(undefined, "http://[::1]:8788/")).toBe("http://localhost:5173");
		expect(resolveAppUrl(undefined, "http://127.0.0.1:8788/")).toBe("http://localhost:5173");
	});

	it("on workers.dev, falls back to the Worker of the same name without -website", () => {
		expect(resolveAppUrl(undefined, "https://acme-website-preview.team.workers.dev/")).toBe("https://acme-preview.team.workers.dev");
		expect(resolveAppUrl(undefined, "https://my-website-website-production.team.workers.dev/x")).toBe("https://my-website-production.team.workers.dev");
	});
});

describe("carrying the theme to the app", () => {
	it("adds the choice to the link", () => {
		expect(withTheme("https://app.acme.io/", "dark")).toBe("https://app.acme.io/?theme=dark");
		expect(withTheme("https://app.acme.io/", "system")).toBe("https://app.acme.io/?theme=system");
	});

	it("replaces the one already there rather than adding a second", () => {
		expect(withTheme("https://app.acme.io/?theme=dark", "light")).toBe("https://app.acme.io/?theme=light");
	});

	it("follows the system when no theme was chosen, or an unknown one was", () => {
		expect(resolveTheme("sepia")).toBe("system");
		expect(resolveTheme(null)).toBe("system");
		expect(withTheme("https://app.acme.io/", "sepia")).toBe("https://app.acme.io/?theme=system");
	});

	it("resolves `system` against what the system says", () => {
		expect(effectiveTheme("system", true)).toBe("dark");
		expect(effectiveTheme("system", false)).toBe("light");
		expect(effectiveTheme("dark", false)).toBe("dark");
	});
});

describe("the dev server's port", () => {
	it("prefers what was asked for", () => {
		expect(appPortFrom("APP_BASE_URL=http://localhost:4000", "7777")).toBe(7777);
	});

	it("follows .env.local, which is where the worktree's port lives", () => {
		expect(appPortFrom("ENVIRONMENT=local\nAPP_BASE_URL=http://localhost:49231\n")).toBe(49231);
		expect(appPortFrom('APP_BASE_URL="http://127.0.0.1:5200"')).toBe(5200);
	});

	it("falls back to 5173", () => {
		expect(appPortFrom(null)).toBe(5173);
		expect(appPortFrom("APP_BASE_URL=https://app.acme.io")).toBe(5173);
	});
});

describe("package.json and paseo.json", () => {
	it("adds the scripts once, and makes `check` cover both Workers", () => {
		const pkg = { scripts: { dev: "vite", check: "tsc -b && vite build && wrangler deploy --dry-run" } };
		const first = withWebsiteScripts(pkg, "website");
		expect(first.added).toContain("dev:all");
		expect(first.added).toContain("check");
		expect((first.pkg.scripts as Record<string, string>).check).toBe("tsc -b && vite build && wrangler deploy --dry-run && npm run check:website");
		expect((first.pkg.scripts as Record<string, string>)["check:website"]).toContain("--config website/wrangler.toml");
		expect((first.pkg.scripts as Record<string, string>).dev).toBe("vite");

		const second = withWebsiteScripts(first.pkg, "website");
		expect(second.added).toEqual([]);
		expect(second.pkg).toEqual(first.pkg);
	});

	it("offers the website as a worktree service, once", () => {
		const paseo = JSON.stringify({ scripts: { dev: { type: "service", command: "bin/worktree-dev" } } });
		const updated = withPaseoWebsiteService(paseo)!;
		expect(JSON.parse(updated).scripts.website).toEqual({ type: "service", command: "bin/worktree-website" });
		expect(withPaseoWebsiteService(updated)).toBeNull();
	});
});

// --- The script itself, on a copy of the project --------------------------

/**
 * A throwaway project: the files setup:website reads and writes, nothing else.
 *
 * Its hostnames are put back to the template's placeholders, so the fixture is
 * a *fresh* project whatever the checkout running the test looks like — a
 * project that has already chosen its domains is a different case, tested on
 * its own below.
 */
function fixture(): string {
	const root = mkdtempSync(join(tmpdir(), "website-setup-"));
	for (const path of ["package.json", "wrangler.toml", "paseo.json", "src/config.ts", "src/react-app/assets", "env"]) {
		cpSync(join(REPO, path), join(root, path), { recursive: true });
	}
	for (const env of ["preview", "production"]) {
		cpSync(join(REPO, "env", `${env}.env.template`), join(root, `.env.${env}`));
	}

	const placeholder = (env: string) => (env === "production" ? "https://app.example.com" : "https://preview.example.com");
	for (const env of ["preview", "production"]) {
		for (const file of [`.env.${env}`, join("env", `${env}.env.template`)]) {
			const content = readFileSync(join(root, file), "utf-8")
				.replace(/^APP_BASE_URL=.*$/m, `APP_BASE_URL=${placeholder(env)}`)
				.replace(/^(CLI_API_URL_[A-Z]+)=.*$/m, `$1=${placeholder(env)}`);
			writeFileSync(join(root, file), content);
		}
	}
	writeFileSync(
		join(root, "src", "config.ts"),
		readFileSync(join(root, "src", "config.ts"), "utf-8").replace(
			/(baseUrls:\s*\{[\s\S]*?preview:\s*)"[^"]*"([\s\S]*?production:\s*)"[^"]*"/,
			'$1"https://preview.example.com"$2"https://app.example.com"',
		),
	);
	writeFileSync(join(root, "wrangler.toml"), readFileSync(join(root, "wrangler.toml"), "utf-8").replace(/^routes\s*=.*$\n/gm, ""));

	// … and of a project that has not run the setup before.
	const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8")) as { scripts: Record<string, string> };
	for (const name of Object.keys(pkg.scripts)) if (/website|^dev:all$|^deploy:all:/.test(name)) delete pkg.scripts[name];
	pkg.scripts.check = pkg.scripts.check.replace(" && npm run check:website", "");
	writeFileSync(join(root, "package.json"), `${JSON.stringify(pkg, null, "\t")}\n`);
	const paseo = JSON.parse(readFileSync(join(root, "paseo.json"), "utf-8")) as { scripts: Record<string, unknown> };
	delete paseo.scripts.website;
	writeFileSync(join(root, "paseo.json"), `${JSON.stringify(paseo, null, 2)}\n`);
	return root;
}

function setup(root: string, args: string[] = []): string {
	// The repo's own tsx, not npx's: the copy has no node_modules of its own.
	// --no-check keeps the tests offline: the only call the setup makes is the
	// read-only "who serves these hostnames?", and a test must not need an account.
	return execFileSync(join(REPO, "node_modules", ".bin", "tsx"), [join(REPO, "bin", "setup-website.ts"), "--yes", "--no-check", ...args], {
		cwd: root,
		encoding: "utf-8",
	});
}

const read = (root: string, file: string) => readFileSync(join(root, file), "utf-8");

function tree(root: string): string[] {
	const out: string[] = [];
	const walk = (dir: string, prefix: string) => {
		for (const entry of readdirSync(dir).sort()) {
			const path = join(dir, entry);
			if (statSync(path).isDirectory()) walk(path, `${prefix}${entry}/`);
			else out.push(`${prefix}${entry}`);
		}
	};
	walk(root, "");
	return out;
}

describe("setup:website, with its defaults", () => {
	let root: string;

	beforeAll(() => {
		root = fixture();
		setup(root, ["--domain", "acme.io"]);
	});
	afterAll(() => rmSync(root, { recursive: true, force: true }));

	it("scaffolds the site, logos included", () => {
		const files = tree(join(root, "website"));
		expect(files).toEqual(
			expect.arrayContaining([
				"public/index.html",
				"public/maintenance.html",
				"public/styles.css",
				"public/js/site.js",
				"public/js/app-link.js",
				"public/assets/logo-light.svg",
				"public/assets/logo-dark.svg",
				"src/worker.ts",
				"src/app-url.ts",
				"wrangler.toml",
			]),
		);
		expect(read(root, "website/public/index.html")).not.toContain("__APP_NAME__");
		// The app's URL is never written into a static file.
		expect(read(root, "website/public/index.html")).not.toContain("acme.io");
	});

	it("gives the site its own Worker, with none of the app's bindings", () => {
		const toml = read(root, "website/wrangler.toml");
		expect(toml).toContain('routes = [{ pattern = "acme.io", custom_domain = true }]');
		expect(toml).toContain('APP_URL = "https://app.acme.io"');
		expect(toml).not.toMatch(/d1_databases|name = "EMAIL"/);
	});

	it("moves the app to app.acme.io everywhere it is named", () => {
		// Added to whatever routes the project had, so the assertion is on the route, not the line.
		expect(read(root, "wrangler.toml")).toContain('{ pattern = "app.acme.io", custom_domain = true }');
		expect(read(root, "wrangler.toml")).toContain('{ pattern = "app.preview-acme.io", custom_domain = true }');
		expect(read(root, ".env.production")).toContain("APP_BASE_URL=https://app.acme.io");
		expect(read(root, ".env.production")).toContain("CLI_API_URL_PRODUCTION=https://app.acme.io");
		expect(read(root, ".env.preview")).toContain("APP_BASE_URL=https://app.preview-acme.io");
		expect(read(root, "env/production.env.template")).toContain("APP_BASE_URL=https://app.acme.io");
		expect(read(root, "src/config.ts")).toContain('production: "https://app.acme.io"');
		expect(read(root, "src/config.ts")).toContain('preview: "https://app.preview-acme.io"');
	});

	it("registers the feature and the commands", () => {
		const settings = loadWebsiteConfig(root)!;
		expect(settings).toEqual({
			dir: "website",
			hosts: { production: "acme.io", preview: "preview-acme.io" },
			app: { production: "https://app.acme.io", preview: "https://app.preview-acme.io" },
		});
		const scripts = (JSON.parse(read(root, "package.json")) as { scripts: Record<string, string> }).scripts;
		expect(scripts["dev:all"]).toBe("tsx bin/dev-all.ts");
		expect(scripts.dev).toBe("vite");
		expect(scripts["deploy:preview"]).toBe("tsx bin/deploy-pipeline.ts --env preview");
		expect(scripts["deploy:website:production"]).toBe("tsx bin/deploy-production.ts --website-only");
		expect(JSON.parse(read(root, "paseo.json")).scripts.website.command).toBe("bin/worktree-website");
	});

	it("changes nothing when it is run again", () => {
		const before = tree(root).map((file) => [file, read(root, file)] as const);
		const output = setup(root, ["--domain", "acme.io"]);
		expect(output).toContain("Nothing to do");
		for (const [file, content] of before) expect([file, read(root, file)]).toEqual([file, content]);
	});
});

describe("setup:website, with every override", () => {
	let root: string;

	beforeAll(() => {
		root = fixture();
		setup(root, [
			"--domain", "acme.io",
			"--subdomain", "console",
			"--dir", "marketing",
			"--preview-host", "staging.acme.io",
			"--preview-app-host", "console-staging.acme.io",
		]);
	});
	afterAll(() => rmSync(root, { recursive: true, force: true }));

	it("uses the folder and the hostnames it was given", () => {
		expect(existsSync(join(root, "marketing", "wrangler.toml"))).toBe(true);
		expect(existsSync(join(root, "website"))).toBe(false);
		expect(read(root, "marketing/wrangler.toml")).toContain('routes = [{ pattern = "staging.acme.io", custom_domain = true }]');
		expect(read(root, "marketing/wrangler.toml")).toContain('APP_URL = "https://console-staging.acme.io"');
		expect(read(root, "wrangler.toml")).toContain('{ pattern = "console.acme.io", custom_domain = true }');
		expect(read(root, ".env.preview")).toContain("APP_BASE_URL=https://console-staging.acme.io");
		expect(loadWebsiteConfig(root)!.dir).toBe("marketing");
		expect(JSON.parse(read(root, "package.json")).scripts["check:website"]).toContain("marketing/wrangler.toml");
	});
});

describe("setup:website without being asked anything", () => {
	it("takes the project's own domain and the defaults", () => {
		const root = fixture();
		writeFileSync(join(root, "src", "config.ts"), read(root, "src/config.ts").replace('"https://app.example.com"', '"https://app.acme.io"'));
		const output = setup(root, ["--defaults"]);

		expect(output).not.toContain("Domain the website is served on");
		expect(loadWebsiteConfig(root)).toEqual({
			dir: "website",
			hosts: { production: "acme.io", preview: "preview-acme.io" },
			app: { production: "https://app.acme.io", preview: "https://app.preview-acme.io" },
		});
		rmSync(root, { recursive: true, force: true });
	});

	it("puts a project with no domain yet on workers.dev", () => {
		// The fixture's config.baseUrls.production is the template's app.example.com.
		const root = fixture();
		const output = setup(root, ["--defaults"]);

		expect(output).toContain("with no domain");
		expect(read(root, "website/wrangler.toml")).not.toContain("routes");
		expect(loadWebsiteConfig(root)!.hosts).toEqual({ production: "", preview: "" });
		rmSync(root, { recursive: true, force: true });
	});

	it("asks nothing when there is no terminal either, so a subprocess cannot hang", () => {
		const root = fixture();
		// `setup()` runs it with a pipe for stdin, which is the case in question.
		const output = setup(root, ["--domain", "acme.io"]);

		expect(output).not.toContain("[app]:");
		expect(loadWebsiteConfig(root)!.hosts.production).toBe("acme.io");
		rmSync(root, { recursive: true, force: true });
	});
});

describe("setup:website --workers-dev", () => {
	let root: string;
	let before: Record<string, string>;

	beforeAll(() => {
		root = fixture();
		before = Object.fromEntries(["wrangler.toml", ".env.production", ".env.preview", "src/config.ts", "env/production.env.template"].map((f) => [f, read(root, f)]));
		setup(root, ["--workers-dev", "--workers-subdomain", "team"]);
	});
	afterAll(() => rmSync(root, { recursive: true, force: true }));

	it("gives the site its own workers.dev address, pointing at the app's", () => {
		const toml = read(root, "website/wrangler.toml");
		expect(toml).not.toContain("routes");
		expect(toml).toContain('APP_URL = "https://cloudflare-fullstack-starter-production.team.workers.dev"');
		expect(loadWebsiteConfig(root)).toEqual({
			dir: "website",
			hosts: {
				production: "cloudflare-fullstack-starter-website-production.team.workers.dev",
				preview: "cloudflare-fullstack-starter-website-preview.team.workers.dev",
			},
			app: {
				production: "https://cloudflare-fullstack-starter-production.team.workers.dev",
				preview: "https://cloudflare-fullstack-starter-preview.team.workers.dev",
			},
		});
	});

	it("leaves the app exactly where it was", () => {
		for (const [file, content] of Object.entries(before)) expect([file, read(root, file)]).toEqual([file, content]);
	});

	it("reads the account from an app already on workers.dev", () => {
		const other = fixture();
		writeFileSync(join(other, ".env.production"), read(other, ".env.production").replace(/^APP_BASE_URL=.*$/m, "APP_BASE_URL=https://x-production.crew.workers.dev"));
		setup(other, ["--workers-dev"]);
		expect(loadWebsiteConfig(other)!.app.preview).toBe("https://cloudflare-fullstack-starter-preview.crew.workers.dev");
		rmSync(other, { recursive: true, force: true });
	});

	it("changes nothing when it is run again", () => {
		expect(setup(root, ["--workers-dev", "--workers-subdomain", "team"])).toContain("Nothing to do");
	});
});

describe("setup:website --dry-run", () => {
	it("writes nothing at all", () => {
		const root = fixture();
		const before = tree(root).map((file) => [file, read(root, file)] as const);
		const output = setup(root, ["--domain", "acme.io", "--dry-run"]);

		expect(output).toContain("Dry run");
		expect(output).toContain("would create website/");
		expect(tree(root)).toEqual(before.map(([file]) => file));
		for (const [file, content] of before) expect([file, read(root, file)]).toEqual([file, content]);
		rmSync(root, { recursive: true, force: true });
	});
});

describe("setup:website on a project already serving the apex", () => {
	it("stops the app serving what the website is about to claim", () => {
		const root = fixture();
		// What `setup:domain` leaves behind on a project live on its apex.
		writeFileSync(
			join(root, "wrangler.toml"),
			readFileSync(join(root, "wrangler.toml"), "utf-8").replace(
				"[env.production]\n",
				'[env.production]\nroutes = [{ pattern = "acme.io", custom_domain = true }]\n',
			),
		);
		const output = setup(root, ["--domain", "acme.io"]);

		// Both halves: the app gains app.acme.io and loses acme.io, which a
		// later `wrangler deploy` would otherwise take back from the website.
		const toml = read(root, "wrangler.toml");
		expect(toml).toContain('{ pattern = "app.acme.io", custom_domain = true }');
		expect(toml).not.toContain('{ pattern = "acme.io", custom_domain = true }');
		expect(output).toContain("stop the production app serving acme.io");
		expect(output).toContain("still attached to the app's Worker on Cloudflare");
		rmSync(root, { recursive: true, force: true });
	});
});

describe("setup:website on a project that has chosen its hostnames", () => {
	it("leaves a URL someone set, and says so", () => {
		const root = fixture();
		writeFileSync(
			join(root, ".env.production"),
			readFileSync(join(root, ".env.production"), "utf-8").replace(/^APP_BASE_URL=.*$/m, "APP_BASE_URL=https://live.acme.io"),
		);
		const output = setup(root, ["--domain", "acme.io"]);

		expect(output).toContain("keeps APP_BASE_URL=https://live.acme.io");
		expect(read(root, ".env.production")).toContain("APP_BASE_URL=https://live.acme.io");
		// Everything else still happens: this is a warning, not a failure.
		expect(existsSync(join(root, "website.config.ts"))).toBe(true);
		rmSync(root, { recursive: true, force: true });
	});
});

describe("a project without a website", () => {
	it("is a project where the feature does not exist", () => {
		const root = fixture();
		expect(loadWebsiteConfig(root)).toBeNull();
		rmSync(root, { recursive: true, force: true });
	});
});

describe("the starter itself", () => {
	it("keeps the app's deploy free of the website", () => {
		const scripts = (JSON.parse(readFileSync(join(REPO, "package.json"), "utf-8")) as { scripts: Record<string, string> }).scripts;
		expect(scripts["deploy:preview"]).not.toMatch(/website/);
		expect(scripts["deploy:production"]).not.toMatch(/website/);
		expect(scripts.dev).toBe("vite");
	});
});
