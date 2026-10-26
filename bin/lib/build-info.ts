/**
 * Release version and commit of the code being built. One implementation shared by
 * vite.config.ts (bakes it into the bundle) and bin/db.ts (waits for a deploy to be live
 * before migrating), so both always agree.
 *
 * - version: committed package.json (bumped by bin/deploy-production). Reading it from the
 *   file, not from git tags, is what lets Cloudflare Workers Builds produce the same value.
 *   With `APP_VERSION_FROM=starter` in the build environment it is the template's own
 *   version (`starter.version`) instead: what the starter's public demo reports, since
 *   the app version of the template itself stays at 0.0.1 for the projects made from it.
 * - commit:  WORKERS_CI_COMMIT_SHA (Workers Builds) → `git rev-parse --short HEAD` → "unknown";
 *   suffixed `-dirty` when building from a working tree with uncommitted changes.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type BuildInfo = { version: string; commit: string };

function git(args: string): string {
	return execSync(`git ${args}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
}

export function resolveBuildInfo(rootDir: string = process.cwd()): BuildInfo {
	const pkg = JSON.parse(readFileSync(resolve(rootDir, "package.json"), "utf8")) as {
		version?: string;
		starter?: { version?: string };
	};
	let commit = (process.env.WORKERS_CI_COMMIT_SHA ?? "").slice(0, 7);
	if (!commit) {
		try {
			commit = git("rev-parse --short HEAD");
			if (git("status --porcelain")) commit += "-dirty";
		} catch {
			commit = "unknown";
		}
	}
	const version = process.env.APP_VERSION_FROM === "starter" ? pkg.starter?.version : pkg.version;
	return { version: version ?? "0.0.0", commit };
}
