/**
 * Release version and commit of the code being built. One implementation shared by
 * vite.config.ts (bakes it into the bundle), bin/db.ts (waits for a deploy to be live
 * before migrating) and bin/deploy-production.ts (bumps and tags it), so all agree.
 *
 * - version: committed package.json (bumped by bin/deploy-production). Reading it from the
 *   file, not from git tags, is what lets Cloudflare Workers Builds produce the same value.
 *   With `APP_VERSION_FROM=starter` in the build environment it is the template's own
 *   version (`starter.version`) instead: what the starter's public demo reports, since
 *   the app version of the template itself stays at 0.0.1 for the projects made from it.
 *   A preview build appends `+preview.<commit>` (semver build metadata, ignored when
 *   versions are compared): same version line, built from unreleased code.
 * - commit:  WORKERS_CI_COMMIT_SHA (Workers Builds; when it is a hash) → `git rev-parse --short HEAD` → "unknown";
 *   suffixed `-dirty` when building from a working tree with uncommitted changes.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type BuildInfo = { version: string; commit: string };

/** The package.json field that carries the release version. */
export type VersionField = "version" | "starter.version";

type PackageJson = { version?: string; starter?: { version?: string } };

function git(args: string): string {
	return execSync(`git ${args}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
}

/**
 * `starter.version` when `APP_VERSION_FROM=starter`, else `version`. The starter
 * repository releases itself this way, so that `version` stays at the 0.0.1 every
 * project created from the template starts with.
 */
export function versionField(appVersionFrom = process.env.APP_VERSION_FROM): VersionField {
	return appVersionFrom === "starter" ? "starter.version" : "version";
}

export function readVersion(pkg: PackageJson, field: VersionField): string | undefined {
	return field === "starter.version" ? pkg.starter?.version : pkg.version;
}

export function resolveBuildInfo(rootDir: string = process.cwd(), environment?: string): BuildInfo {
	const pkg = JSON.parse(readFileSync(resolve(rootDir, "package.json"), "utf8")) as PackageJson;
	// A build started through the API for a branch gets the branch name here.
	const ciSha = process.env.WORKERS_CI_COMMIT_SHA ?? "";
	let commit = /^[0-9a-f]{7,40}$/.test(ciSha) ? ciSha.slice(0, 7) : "";
	if (!commit) {
		try {
			commit = git("rev-parse --short HEAD");
			if (git("status --porcelain")) commit += "-dirty";
		} catch {
			commit = "unknown";
		}
	}
	const version = readVersion(pkg, versionField()) ?? "0.0.0";
	return { version: environment === "preview" ? `${version}+preview.${commit}` : version, commit };
}
