import { describe, expect, it } from "vitest";
import {
	fillEnv,
	isPlaceholder,
	releaseRuleset,
	requiredCheckNames,
	tokenTemplateUrl,
	triggerDrift,
	triggerSettings,
	withWorkersBuildsMode,
} from "../../bin/lib/setup-ci";

describe("Workers Builds trigger", () => {
	it("builds the environment's branch with its own build and the CI deploy", () => {
		expect(triggerSettings("production", "release")).toMatchObject({
			branch_includes: ["release"],
			build_command: "npm run build:production",
			deploy_command: "npm run deploy:ci -- --env production",
			root_directory: "/",
		});
	});

	it("reports what differs, ignoring a name chosen in the dashboard", () => {
		const wanted = triggerSettings("preview", "preview");
		expect(triggerDrift({ ...wanted, trigger_name: "my name" }, wanted)).toEqual([]);
		// What the dashboard's Connect leaves behind.
		const fromDashboard = { ...wanted, branch_includes: ["main"], build_command: "", deploy_command: "npx wrangler deploy" };
		expect(triggerDrift(fromDashboard, wanted)).toEqual(["build_command", "deploy_command", "branch_includes"]);
	});
});

describe(".env values", () => {
	it("treats empty values and the template's examples as unset", () => {
		for (const v of [undefined, "", "https://app.example.com", "https://preview.example.com/", "YOUR_PREVIEW_D1_DATABASE_ID"]) {
			expect(isPlaceholder(v)).toBe(true);
		}
		for (const v of ["https://app.acme.io", "https://example.community", "s3cr3t"]) expect(isPlaceholder(v)).toBe(false);
	});

	it("fills placeholders and missing keys, never a value someone set", () => {
		const file = "# comment\nAPP_BASE_URL=https://app.example.com\nBETTER_AUTH_SECRET=\nCLI_API_KEY=kept\n";
		const { content, changed } = fillEnv(file, {
			APP_BASE_URL: "https://x.dev.workers.dev",
			BETTER_AUTH_SECRET: "new",
			CLI_API_KEY: "replaced?",
			D1_DATABASE_ID: "abc",
		});
		expect(changed).toEqual(["APP_BASE_URL", "BETTER_AUTH_SECRET", "D1_DATABASE_ID"]);
		expect(content).toBe("# comment\nAPP_BASE_URL=https://x.dev.workers.dev\nBETTER_AUTH_SECRET=new\nCLI_API_KEY=kept\nD1_DATABASE_ID=abc\n");
	});
});

describe("deploy.config.ts", () => {
	it("switches the mode to workers-builds and leaves the rest", () => {
		const source = 'export const deployConfig = {\n\tmode: "manual" as DeployMode,\n\tbranches: {},\n};\n';
		expect(withWorkersBuildsMode(source)).toBe(source.replace('"manual"', '"workers-builds"'));
		expect(withWorkersBuildsMode("export const deployConfig = {};")).toBeNull();
	});
});

describe("release branch protection", () => {
	it("requires the GitHub Actions checks of main, once each, pinned to GitHub Actions", () => {
		const run = (name: string, slug = "github-actions") => ({ name, status: "completed", conclusion: "success", app: { slug } });
		const checks = requiredCheckNames([run("e2e"), run("build-and-lint"), run("e2e"), run("Workers Builds", "cloudflare-workers-and-pages")]);
		expect(checks).toEqual(["build-and-lint", "e2e"]);

		const ruleset = releaseRuleset("release", checks);
		expect(ruleset.conditions.ref_name.include).toEqual(["refs/heads/release"]);
		expect(ruleset.bypass_actors).toEqual([]);
		expect(ruleset.rules.find((r) => r.type === "required_status_checks")?.parameters).toEqual({
			strict_required_status_checks_policy: false,
			do_not_enforce_on_create: false,
			required_status_checks: [
				{ context: "build-and-lint", integration_id: 15368 },
				{ context: "e2e", integration_id: 15368 },
			],
		});
	});
});

it("links to a prefilled user token page", () => {
	const url = new URL(tokenTemplateUrl());
	expect(url.pathname).toBe("/profile/api-tokens");
	expect(JSON.parse(url.searchParams.get("permissionGroupKeys")!)).toContainEqual({ key: "d1", type: "edit" });
});
