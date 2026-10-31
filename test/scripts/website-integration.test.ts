import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Does a project with a website still build, typecheck, lint and deploy?
 *
 * It runs a real `setup:website` on a copy of the whole repository and then the
 * project's own checks over it, so it is slow (a few minutes) and deliberately
 * NOT part of `npm test`:
 *
 *   npm run test:website:integration
 *
 * `npm test` covers the decisions (test/scripts/website.test.ts); this covers
 * the one thing unit tests cannot — that the result is a project the toolchain
 * accepts. See docs/WEBSITE.md.
 */
const RUN = process.env.WEBSITE_INTEGRATION === "1";
const REPO = resolve(import.meta.dirname, "..", "..");
const SKIP = ["node_modules", ".git", "dist", ".wrangler", "test-results", "playwright-report", "website"];

describe.skipIf(!RUN)("a project with a website", () => {
	let root: string;
	const run = (command: string, args: string[]) =>
		execFileSync(command.startsWith("/") ? command : join(root, "node_modules", ".bin", command), args, {
			cwd: root,
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "pipe"],
			timeout: 600_000,
		});

	beforeAll(() => {
		root = mkdtempSync(join(tmpdir(), "website-integration-"));
		cpSync(REPO, root, { recursive: true, filter: (source) => !SKIP.includes(source.slice(REPO.length + 1).split("/")[0]) });
		// Shared rather than installed: this is about the project's own files.
		symlinkSync(join(REPO, "node_modules"), join(root, "node_modules"));
		run(join(REPO, "node_modules", ".bin", "tsx"), [join(root, "bin", "setup-website.ts"), "--yes", "--domain", "acme.io"]);
	}, 600_000);

	afterAll(() => rmSync(root, { recursive: true, force: true }));

	it("typechecks, the website Worker included", () => {
		expect(() => run("tsc", ["-b", "--force"])).not.toThrow();
	}, 600_000);

	it("lints", () => {
		expect(() => run("eslint", ["."])).not.toThrow();
	}, 600_000);

	it("builds the app", () => {
		expect(() => run("vite", ["build"])).not.toThrow();
	}, 600_000);

	it("would deploy the app", () => {
		expect(run("wrangler", ["deploy", "--dry-run"])).toContain("Total Upload");
	}, 600_000);

	it("would deploy the website, to its own Worker", () => {
		const output = run("wrangler", ["deploy", "--dry-run", "--config", "website/wrangler.toml", "--env", "production"]);
		expect(output).toContain('env.APP_URL ("https://app.acme.io")');
		expect(output).toContain('env.ENVIRONMENT ("production")');
		// None of the app's: no database, no mail, no secret.
		expect(output).not.toMatch(/env\.DB|env\.EMAIL|D1 Database/);
	}, 600_000);
});
