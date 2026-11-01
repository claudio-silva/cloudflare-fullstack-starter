/**
 * Is this repository the project's own, or still the starter's?
 *
 * A project created with "Use this template" gets a clean repository. One
 * created with `git clone` inherits two things that quietly belong to the
 * starter: the `origin` remote, and every release tag. Neither is obvious, and
 * both do damage later —
 *
 *   - `deploy:production` pushes the release commit and its tag to `origin`;
 *   - it also reads the latest `vX.Y.Z` tag to work out the next version, so a
 *     project's first release calls itself v3.7.1 rather than v0.0.2.
 *
 * `npm run init` cuts both ties, and the release refuses to run while either
 * is still there. See docs/AGENTS_SETUP.md.
 */
import { execFileSync } from "node:child_process";

export type StarterIdentity = { repo: string; version: string };

/** `https://github.com/me/app.git`, `git@github.com:me/app` → `github.com/me/app`. */
export function remoteIdentity(url: string): string {
	return url
		.trim()
		.toLowerCase()
		.replace(/^[a-z+]+:\/\//, "")
		.replace(/^git@/, "")
		.replace(/^([^/:]+):/, "$1/")
		.replace(/^[^@/]+@/, "")
		.replace(/\.git$/, "")
		.replace(/\/+$/, "");
}

/** Does this remote point at the starter's own repository? */
export function isStarterRemote(url: string, starterRepo: string): boolean {
	return Boolean(url) && remoteIdentity(url) === remoteIdentity(starterRepo);
}

const RELEASE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

function order(version: string): number[] {
	const m = RELEASE_TAG.exec(version.startsWith("v") ? version : `v${version}`);
	return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [-1, -1, -1];
}

function notAfter(tag: string, version: string): boolean {
	const [a, b, c] = order(tag);
	const [x, y, z] = order(version);
	return a < x || (a === x && (b < y || (b === y && c <= z)));
}

/**
 * The release tags that came from the starter rather than from this project.
 *
 * The signal is the starter's own version being among them while the project
 * numbers itself differently: a project that has released v1.2.0 of its own
 * has no reason to carry the starter's v3.7.0. Tags *newer* than the starter's
 * version are left alone whatever happens — they can only be the project's.
 */
export function inheritedTags(tags: string[], starter: StarterIdentity, projectVersion: string): string[] {
	const releases = tags.filter((t) => RELEASE_TAG.test(t));
	if (!starter.version || projectVersion === starter.version) return [];
	if (!releases.includes(`v${starter.version}`)) return [];
	return releases.filter((t) => notAfter(t, starter.version));
}

// --- The repository as it is ----------------------------------------------

function git(args: string[]): string {
	try {
		return execFileSync("git", args, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		return "";
	}
}

export type InheritedGit = { origin: string | null; tags: string[] };

/** What this repository still carries from the starter. */
export function inheritedFromStarter(starter: StarterIdentity, projectVersion: string): InheritedGit {
	const origin = git(["remote", "get-url", "origin"]);
	return {
		origin: origin && isStarterRemote(origin, starter.repo) ? origin : null,
		tags: inheritedTags(git(["tag", "--list", "v*.*.*"]).split("\n").filter(Boolean), starter, projectVersion),
	};
}

/** Remove them. The remote is forgotten, not renamed: the project's own is the only one it should have. */
export function detachFromStarter(inherited: InheritedGit): void {
	if (inherited.origin) git(["remote", "remove", "origin"]);
	if (inherited.tags.length) git(["tag", "-d", ...inherited.tags]);
}

/** The message a command should print before refusing to release. */
export function detachAdvice(inherited: InheritedGit): string[] {
	const lines: string[] = [];
	if (inherited.origin) {
		lines.push(
			`\`origin\` is still the starter's repository (${inherited.origin}).`,
			"  A release would push your commits and tags there. Point it at your own:",
			"    git remote set-url origin <your repository>",
		);
	}
	if (inherited.tags.length) {
		const shown = inherited.tags.slice(-3).join(", ");
		lines.push(
			`This repository carries ${inherited.tags.length} release tag(s) of the starter (${shown}${inherited.tags.length > 3 ? ", …" : ""}).`,
			"  The next version is worked out from the latest tag, so your first release would take the starter's number. Drop them:",
			`    git tag -d $(git tag -l 'v*.*.*')`,
		);
	}
	return lines;
}
