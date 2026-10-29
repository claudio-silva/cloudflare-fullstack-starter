import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readVersion, resolveBuildInfo, versionField } from "../../bin/lib/build-info";
import { githubRepo, summarizeChecks, type CheckRun } from "../../bin/lib/ci-checks";
import { checkReleaseTag, parseLsRemoteTag } from "../../bin/lib/release-tag";
import { nextVersion } from "../../bin/lib/release-version";

// A project created from the template: its own version, the starter's beside it.
const pkg = { version: "0.0.1", starter: { version: "3.4.0" } };

describe("release field", () => {
	it("is `version` unless APP_VERSION_FROM=starter", () => {
		expect(versionField(undefined)).toBe("version");
		expect(versionField("")).toBe("version");
		expect(versionField("app")).toBe("version");
		expect(versionField("starter")).toBe("starter.version");
	});

	it("reads the chosen field", () => {
		expect(readVersion(pkg, "version")).toBe("0.0.1");
		expect(readVersion(pkg, "starter.version")).toBe("3.4.0");
		expect(readVersion({ version: "1.0.0" }, "starter.version")).toBeUndefined();
	});
});

describe("nextVersion", () => {
	it("releases a new project's own version unbumped, whatever the starter's", () => {
		expect(nextVersion("", readVersion(pkg, "version")!, "patch")).toBe("v0.0.1");
	});

	it("bumps the latest tag when the field is not ahead of it", () => {
		expect(nextVersion("v3.4.0", "3.4.0", "patch")).toBe("v3.4.1");
		expect(nextVersion("v3.4.0", "3.4.0", "minor")).toBe("v3.5.0");
		expect(nextVersion("v3.4.0", "3.4.0", "major")).toBe("v4.0.0");
	});

	it("releases the field as-is when it is ahead of the latest tag", () => {
		// The starter repository: starter.version set by hand to the next release.
		expect(nextVersion("v3.3.0", readVersion(pkg, "starter.version")!, "patch")).toBe("v3.4.0");
		// Measured against the wrong field, the template's 0.0.1 would be "behind" and bumped.
		expect(nextVersion("v3.3.0", readVersion(pkg, "version")!, "patch")).toBe("v3.3.1");
	});

	it("refuses what it cannot parse", () => {
		expect(() => nextVersion("", "", "patch")).toThrow(/not X\.Y\.Z/);
		expect(() => nextVersion("release-1", "1.0.0", "patch")).toThrow(/non-semver/);
	});
});

describe("resolveBuildInfo", () => {
	let dir: string;
	const saved = { sha: process.env.WORKERS_CI_COMMIT_SHA, from: process.env.APP_VERSION_FROM };

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "build-info-"));
		writeFileSync(join(dir, "package.json"), JSON.stringify(pkg));
		process.env.WORKERS_CI_COMMIT_SHA = "abcdef0123456789";
	});
	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
		for (const [key, value] of [["WORKERS_CI_COMMIT_SHA", saved.sha], ["APP_VERSION_FROM", saved.from]] as const) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});

	it("reports the project's version, or the starter's with APP_VERSION_FROM=starter", () => {
		delete process.env.APP_VERSION_FROM;
		expect(resolveBuildInfo(dir, "production")).toEqual({ version: "0.0.1", commit: "abcdef0" });
		process.env.APP_VERSION_FROM = "starter";
		expect(resolveBuildInfo(dir, "production")).toEqual({ version: "3.4.0", commit: "abcdef0" });
	});

	it("marks a preview build with semver build metadata", () => {
		process.env.APP_VERSION_FROM = "starter";
		expect(resolveBuildInfo(dir, "preview").version).toBe("3.4.0+preview.abcdef0");
		expect(resolveBuildInfo(dir, "development").version).toBe("3.4.0");
	});
});

describe("CI checks", () => {
	const run = (name: string, status: string, conclusion: string | null, slug = "github-actions"): CheckRun => ({
		name,
		status,
		conclusion,
		app: { slug },
	});

	it("passes when every GitHub Actions check passed", () => {
		expect(summarizeChecks([run("build-and-lint", "completed", "success"), run("e2e", "completed", "skipped")])).toEqual({
			state: "success",
		});
	});

	it("fails on any failed check, even with others still running", () => {
		expect(summarizeChecks([run("build-and-lint", "completed", "failure"), run("e2e", "in_progress", null)])).toEqual({
			state: "failure",
			failed: ["build-and-lint"],
		});
		expect(summarizeChecks([run("e2e", "completed", "cancelled")]).state).toBe("failure");
	});

	it("waits while checks run", () => {
		expect(summarizeChecks([run("build-and-lint", "completed", "success"), run("e2e", "queued", null)])).toEqual({
			state: "pending",
			pending: ["e2e"],
		});
	});

	it("ignores other apps, such as a Workers Builds preview deploy", () => {
		expect(summarizeChecks([run("Workers Builds", "completed", "failure", "cloudflare-workers-and-pages")])).toEqual({
			state: "none",
		});
		expect(summarizeChecks([]).state).toBe("none");
	});

	it("recognises GitHub remotes only", () => {
		expect(githubRepo("git@github.com:claudio-silva/cloudflare-fullstack-starter.git\n")).toBe("claudio-silva/cloudflare-fullstack-starter");
		expect(githubRepo("https://github.com/o/r.git")).toBe("o/r");
		expect(githubRepo("https://x-access-token:t@github.com/o/r")).toBe("o/r");
		expect(githubRepo("ssh://git@github.com/o/r.git")).toBe("o/r");
		expect(githubRepo("git@gitlab.com:o/r.git")).toBeNull();
		expect(githubRepo("https://github.example.com/o/r.git")).toBeNull();
	});
});

describe("release tag of a CI production deploy", () => {
	const head = "b626e5f6689b9b0257cb84fdc6d7944ebf9f5232";

	it("reads the commit of an annotated or a lightweight tag from ls-remote", () => {
		const annotated = `9645509 refs/tags/v3.4.0\n${head}\trefs/tags/v3.4.0^{}\nabc1234\trefs/tags/v3.4.0-rc\n`;
		expect(parseLsRemoteTag(annotated, "v3.4.0")).toBe(head);
		expect(parseLsRemoteTag(`${head}\trefs/tags/v3.4.0\n`, "v3.4.0")).toBe(head);
		expect(parseLsRemoteTag("abc1234\trefs/tags/v3.4.0-rc\n", "v3.4.0")).toBeNull();
		expect(parseLsRemoteTag("", "v3.4.0")).toBeNull();
	});

	it("deploys only the commit its version's tag points at", () => {
		expect(checkReleaseTag("3.4.0", head, () => head)).toEqual({ ok: true });
		expect(checkReleaseTag("3.4.0", head, () => null)).toEqual({
			ok: false,
			reason: "b626e5f reports 3.4.0 but there is no tag v3.4.0",
		});
		expect(checkReleaseTag("3.4.0", head, () => "29fc6d5a89ef6d93250e548f261f2f7555febd96")).toMatchObject({ ok: false });
	});

	it("lets the deploy through, with a note, when the tag cannot be looked up", () => {
		expect(checkReleaseTag("3.4.0", head, () => undefined)).toMatchObject({ ok: true, note: expect.stringContaining("not checked") });
	});
});
