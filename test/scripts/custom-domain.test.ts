import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { customDomains, normalizeHostname, withCustomDomainRoute, zoneCandidates } from "../../bin/lib/custom-domain";
import { fillEnv } from "../../bin/lib/setup-ci";

describe("custom domain hostname", () => {
	it("takes what a person types", () => {
		expect(normalizeHostname("https://App.Example.com/login")).toBe("app.example.com");
		expect(normalizeHostname("example.com.")).toBe("example.com");
		expect(normalizeHostname("my-app.co.uk")).toBe("my-app.co.uk");
	});

	it("refuses what cannot be a custom domain", () => {
		for (const v of ["localhost", "http://localhost:5173", "app", "-x.example.com", "x.my.workers.dev", "1.2.3.4", "a b.com"]) {
			expect(normalizeHostname(v)).toBeNull();
		}
	});

	it("looks for its zone from the most specific name", () => {
		expect(zoneCandidates("a.b.example.com")).toEqual(["a.b.example.com", "b.example.com", "example.com"]);
		expect(zoneCandidates("example.com")).toEqual(["example.com"]);
	});
});

describe("custom domain in wrangler.toml", () => {
	const base = `name = "app"\n\n[env.production]\n[env.production.vars]\nENVIRONMENT = "production"\n`;

	it("adds the route to the environment, keeping the rest of the file", () => {
		const out = withCustomDomainRoute(base, "production", "app.acme.io")!;
		expect(out).toBe(`name = "app"\n\n[env.production]\nroutes = [{ pattern = "app.acme.io", custom_domain = true }]\n[env.production.vars]\nENVIRONMENT = "production"\n`);
		expect(customDomains(out, "production")).toEqual(["app.acme.io"]);
		expect(customDomains(out, "preview")).toEqual([]);
	});

	it("is a no-op when the domain is there", () => {
		const once = withCustomDomainRoute(base, "production", "app.acme.io")!;
		expect(withCustomDomainRoute(once, "production", "app.acme.io")).toBeNull();
	});

	it("keeps routes the project has", () => {
		const withRoute = base.replace("[env.production]\n", `[env.production]\nroutes = ["acme.io/blog/*"]\n`);
		const out = withCustomDomainRoute(withRoute, "production", "app.acme.io")!;
		expect(out).toContain(`routes = ["acme.io/blog/*", { pattern = "app.acme.io", custom_domain = true }]`);
	});

	it("follows a project that writes routes as tables", () => {
		const tables = `${base}\n[[env.production.routes]]\npattern = "old.acme.io"\ncustom_domain = true\n`;
		expect(customDomains(withCustomDomainRoute(tables, "production", "app.acme.io")!, "production")).toEqual(["old.acme.io", "app.acme.io"]);
	});

	it("creates the environment's table when only its sub-tables exist", () => {
		const noHeader = `name = "app"\n[env.preview.vars]\nENVIRONMENT = "preview"\n`;
		expect(customDomains(withCustomDomainRoute(noHeader, "preview", "preview.acme.io")!, "preview")).toEqual(["preview.acme.io"]);
	});

	it("edits the starter's own wrangler.toml", () => {
		const source = readFileSync("wrangler.toml", "utf-8");
		const out = withCustomDomainRoute(source, "production", "app.acme.io")!;
		expect(customDomains(out, "production")).toEqual(["app.acme.io"]);
		expect(out.split("\n").length).toBe(source.split("\n").length + 1);
	});

	it("refuses a routes array it cannot edit safely", () => {
		const multi = base.replace("[env.production]\n", `[env.production]\nroutes = [\n  "acme.io/blog/*",\n]\n`);
		expect(() => withCustomDomainRoute(multi, "production", "app.acme.io")).toThrow(/by hand/);
	});
});

describe(".env values, overwritten", () => {
	it("replaces a value someone set, and reports only what changed", () => {
		const file = "APP_BASE_URL=https://x.dev.workers.dev\nCLI_API_URL_PRODUCTION=https://app.acme.io\n";
		const { content, changed } = fillEnv(file, { APP_BASE_URL: "https://app.acme.io", CLI_API_URL_PRODUCTION: "https://app.acme.io" }, { overwrite: true });
		expect(changed).toEqual(["APP_BASE_URL"]);
		expect(content).toBe("APP_BASE_URL=https://app.acme.io\nCLI_API_URL_PRODUCTION=https://app.acme.io\n");
	});
});
