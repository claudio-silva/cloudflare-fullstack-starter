/**
 * Is the commit being deployed a release? A CI production deploy checks that
 * it carries the `vX.Y.Z` tag of the version it reports, so that a push to the
 * deployment branch that did not come from `deploy:production` deploys nothing.
 *
 * Workers Builds starts on any push to its branch, and a CI clone is often
 * shallow and without tags, so the tag is looked up locally first and then on
 * `origin`.
 */
import { execFileSync } from "node:child_process";

function git(args: string[]): string {
	return execFileSync("git", args, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

/**
 * The commit `tag` points at, from `git ls-remote --tags` output. An annotated
 * tag lists the tag object and, as `<tag>^{}`, the commit; a lightweight one
 * lists the commit only.
 */
export function parseLsRemoteTag(output: string, tag: string): string | null {
	let direct: string | null = null;
	for (const line of output.split("\n")) {
		const [sha, ref] = line.trim().split(/\s+/);
		if (ref === `refs/tags/${tag}^{}`) return sha;
		if (ref === `refs/tags/${tag}`) direct = sha;
	}
	return direct;
}

/** The commit `tag` points at; null when there is no such tag; undefined when it cannot be found out. */
export function tagCommit(tag: string): string | null | undefined {
	try {
		return git(["rev-parse", "-q", "--verify", `refs/tags/${tag}^{commit}`]);
	} catch {
		// Not here; ask the remote.
	}
	try {
		return parseLsRemoteTag(git(["ls-remote", "--tags", "origin", `refs/tags/${tag}*`]), tag);
	} catch {
		return undefined;
	}
}

export type ReleaseCheck = { ok: true; note?: string } | { ok: false; reason: string };

export function checkReleaseTag(version: string, head: string, lookup = tagCommit): ReleaseCheck {
	const tag = `v${version}`;
	const commit = lookup(tag);
	if (commit === undefined) return { ok: true, note: `cannot look up tag ${tag} (no access to origin); not checked` };
	if (commit === null) return { ok: false, reason: `${head.slice(0, 7)} reports ${version} but there is no tag ${tag}` };
	if (!commit.startsWith(head) && !head.startsWith(commit)) {
		return { ok: false, reason: `tag ${tag} is ${commit.slice(0, 7)}, not the commit being deployed (${head.slice(0, 7)})` };
	}
	return { ok: true };
}
