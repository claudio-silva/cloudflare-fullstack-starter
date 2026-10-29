#!/usr/bin/env tsx
/**
 * Cut a production release.
 *
 * Whatever `deployConfig.mode` says, **the release is always started by this
 * command**, and always carries a version tag. A merge into the deployment
 * branch with no tag deploys nothing. That is deliberate: an automated deploy
 * triggered by a bare push puts code online with no version attached to it,
 * and two different builds then answer to the same version number.
 *
 *   manual          build, migrate and deploy from this machine, then tag.
 *                   The tag follows success, because there is no trigger to arm.
 *   workers-builds  push main, push the tag, promote the branch, then let
 *                   Cloudflare build. The tag precedes the deploy because it is
 *                   what the build checks.
 *   external-ci     same, with your own CI doing the build.
 *
 * `--local` forces the manual path in any mode, for when you want to watch a
 * release happen rather than read about it afterwards.
 *
 * The version lives in package.json, not in the tag, so every builder — this
 * script, Workers Builds, GitLab CI — produces the same value. The tag only
 * marks the commit that carries it.
 *
 * NEVER run this against production without explicit approval.
 */

import { execFileSync } from "node:child_process";
import { loadDeployConfig, parseEnvFile } from "./lib/deploy-config";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

const ENV = "production" as const;

function git(args: string[]): string {
	return execFileSync("git", args, { encoding: "utf-8" }).trim();
}

function run(command: string, args: string[]): void {
	console.log(`  $ ${command} ${args.join(" ")}`);
	execFileSync(command, args, { stdio: "inherit" });
}

function die(message: string): never {
	console.error(`deploy-production: ${message}`);
	process.exit(1);
}

function usage(): void {
	console.log(`Usage: npm run deploy:production -- [options]

  --patch | --minor | --major   Bump kind (default: --patch); ignored while package.json
                                is ahead of the latest tag, which is released as-is.
                                A new major (before 1.0.0, a new minor) reloads every
                                open tab at once: use it for incompatible API changes
  --version, -v X.Y.Z           Use this exact version
  --local                       Build and deploy from this machine, whatever the mode
  --release-only                Bump, tag and push; do not deploy or trigger CI
  --yes, -y                     Do not prompt
  --dry-run                     Show the plan; change nothing
  --help, -h`);
}

function semver(version: string): [number, number, number] | null {
	const m = version.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
	return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function isAhead(a: [number, number, number], b: [number, number, number]): boolean {
	for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
	return false;
}

/**
 * The next release. Normally the latest tag, bumped. But when `package.json`
 * is ahead of every tag, someone chose that version by hand — or the project
 * is new and still on the 0.0.1 it was created with — so it ships unbumped.
 */
function nextVersion(latest: string, pkgVersion: string, kind: "patch" | "minor" | "major"): string {
	const pkg = semver(pkgVersion);
	if (!latest) {
		if (!pkg) die(`package.json version ${pkgVersion} is not X.Y.Z`);
		return `v${pkgVersion}`;
	}
	const parsed = semver(latest);
	if (!parsed) die(`cannot bump non-semver tag ${latest}`);
	if (pkg && isAhead(pkg, parsed)) return `v${pkgVersion}`;
	const [ma, mi, pa] = parsed;
	if (kind === "major") return `v${ma + 1}.0.0`;
	if (kind === "minor") return `v${ma}.${mi + 1}.0`;
	return `v${ma}.${mi}.${pa + 1}`;
}

async function confirm(question: string): Promise<boolean> {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	const answer = await new Promise<string>((done) => rl.question(question, done));
	rl.close();
	return answer.toLowerCase() === "y";
}

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** Wait until the deployed Worker reports the version we just released. */
async function waitForVersion(version: string, timeoutMs = 600_000): Promise<void> {
	const { getApiBaseUrl } = await import("../src/cli/utils/db");
	const baseUrl = getApiBaseUrl(ENV);
	const expected = version.replace(/^v/, "");
	const deadline = Date.now() + timeoutMs;
	let seen = "no response";
	console.log(`Waiting for ${baseUrl} to serve ${expected} …`);
	while (Date.now() < deadline) {
		try {
			const body = (await (await fetch(`${baseUrl}/api/`)).json()) as { version?: string };
			seen = body.version ?? "?";
			if (seen === expected) {
				console.log(`✓ ${baseUrl} serves ${seen}`);
				return;
			}
		} catch {
			seen = "no response";
		}
		await sleep(5_000);
	}
	die(`${baseUrl} still serves ${seen} after ${timeoutMs / 1000}s; expected ${expected}. Check the CI build.`);
}

/**
 * Push a ref without starting a pipeline for it. `ci.skip` is GitLab's push
 * option; a host that rejects push options gets a plain push instead. Where
 * the CI still runs, its deploy job stops at bin/ci-deploy-guard.ts when the
 * mode is `manual` — `--local` in a CI mode is the one case left to it.
 */
function pushWithoutCi(ref: string): void {
	try {
		run("git", ["push", "-o", "ci.skip", "origin", ref]);
	} catch {
		run("git", ["push", "origin", ref]);
	}
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	if (args.includes("--help") || args.includes("-h")) return usage();

	const kind = args.includes("--major") ? "major" : args.includes("--minor") ? "minor" : "patch";
	const explicit = args.includes("-v") ? args[args.indexOf("-v") + 1] : args.includes("--version") ? args[args.indexOf("--version") + 1] : "";
	const yes = args.includes("--yes") || args.includes("-y");
	const dryRun = args.includes("--dry-run");
	const forceLocal = args.includes("--local");
	const releaseOnly = args.includes("--release-only");

	const cfg = loadDeployConfig(ENV);
	const mode = forceLocal ? "manual" : cfg.mode;

	// --- Preconditions -------------------------------------------------------
	const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
	if (branch !== "main") die(`production releases are cut from main (on ${branch})`);
	const dirty = git(["status", "--porcelain"]);
	if (dirty) {
		console.error(dirty);
		if (!dryRun) die("working tree must be clean");
		console.error("warning: working tree not clean (would abort a real run)");
	}
	git(["fetch", "origin", "--tags", "--quiet"]);
	if (git(["rev-parse", "HEAD"]) !== git(["rev-parse", "origin/main"])) {
		die("main differs from origin/main; pull/push first");
	}

	// Secrets live on the Worker, synced from a developer's machine. In a CI
	// mode nobody syncs them during the deploy, so a stale .env is only
	// discovered when the new code cannot find a secret it needs.
	if (mode !== "manual" && !releaseOnly) {
		const envFile = parseEnvFile(resolve(process.cwd(), `.env.${ENV}`));
		if (Object.keys(envFile).length > 0) {
			console.log("Reminder: CI does not sync secrets. Run `npm run sync-secrets -- production` if .env.production changed.");
		}
	}

	// --- Version -------------------------------------------------------------
	const originalSha = git(["rev-parse", "HEAD"]);
	const headTag = git(["tag", "--points-at", "HEAD", "--list", "v*.*.*", "--sort=-v:refname"]).split("\n")[0];
	const latest = git(["tag", "--list", "v*.*.*", "--sort=-v:refname"]).split("\n")[0];
	const pkgVersion = JSON.parse(execFileSync("node", ["-p", "JSON.stringify(require('./package.json'))"], { encoding: "utf-8" })).version as string;

	let version: string;
	let tagNeeded: boolean;
	if (headTag) {
		if (explicit && `v${explicit.replace(/^v/, "")}` !== headTag) die(`HEAD is already ${headTag}`);
		version = headTag;
		if (`v${pkgVersion}` !== version) die(`package.json (v${pkgVersion}) does not match tag ${version}`);
		tagNeeded = false;
		console.log(`HEAD is already ${version}; redeploying it.`);
	} else {
		tagNeeded = true;
		version = explicit ? `v${explicit.replace(/^v/, "")}` : nextVersion(latest, pkgVersion, kind);
		if (!/^v\d+\.\d+\.\d+$/.test(version)) die(`version must be vX.Y.Z (got ${version})`);
	}
	const needsCommit = `v${pkgVersion}` !== version;

	console.log(`Latest tag : ${latest || "<none>"}`);
	console.log(`Release    : ${version} (${git(["rev-parse", "--short", "HEAD"])})`);
	console.log(`Mode       : ${mode}${forceLocal && cfg.mode !== "manual" ? ` (forced local; config says ${cfg.mode})` : ""}`);
	console.log(`Branch     : ${mode === "manual" ? "n/a" : cfg.branch}`);
	if (dryRun) return console.log("(dry run — nothing changed)");
	if (!yes && !(await confirm(`Proceed with ${version}? [y/N] `))) die("aborted");

	// --- Release -------------------------------------------------------------
	if (needsCommit) {
		run("npm", ["pkg", "set", `version=${version.replace(/^v/, "")}`]);
		run("git", ["commit", "-qam", `Release ${version}`]);
	}

	const rollback = () => {
		if (needsCommit) {
			console.error("Deploy failed; dropping local release commit.");
			execFileSync("git", ["reset", "--hard", originalSha], { stdio: "ignore" });
		}
	};

	if (mode === "manual" && !releaseOnly) {
		// No trigger to arm, so the tag follows a successful deploy: a failed
		// release leaves no tag claiming a version that never went live.
		try {
			run("npx", ["tsx", "bin/deploy-pipeline.ts", "--env", ENV]);
		} catch {
			rollback();
			process.exit(1);
		}
	}

	if (tagNeeded) {
		run("git", ["tag", "-a", version, "-m", version]);
		run("git", ["push", "origin", "main"]);
		// Already deployed from here (manual mode, or --local): the tag is a
		// record, not a trigger, and a CI watching tags must not deploy it again.
		if (mode === "manual") pushWithoutCi(version);
		else run("git", ["push", "origin", version]);
		console.log(`Tagged ${version}`);
	} else if (mode !== "manual") {
		run("git", ["push", "origin", "main"]);
	}

	if (releaseOnly) return console.log(`Done: ${version} (release-only; nothing deployed)`);

	if (mode !== "manual") {
		// Promote by fast-forward: the deployment branch only ever holds commits
		// that already passed through main.
		run("git", ["push", "origin", `main:${cfg.branch}`]);
		const hookUrl = parseEnvFile(resolve(process.cwd(), `.env.${ENV}`)).DEPLOY_HOOK_URL ?? process.env.DEPLOY_HOOK_URL;
		if (mode === "workers-builds" && hookUrl) {
			console.log("Triggering the Workers Builds deploy hook …");
			const res = await fetch(hookUrl, { method: "POST" });
			if (!res.ok) die(`deploy hook returned HTTP ${res.status}`);
		}
		await waitForVersion(version);
	}

	console.log(`Done: ${version}`);
}

main().catch((error: unknown) => {
	console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
});
