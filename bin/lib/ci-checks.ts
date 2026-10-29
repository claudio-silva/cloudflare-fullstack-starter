/**
 * Has CI passed on a commit? Read by `deploy-production` so that a commit whose
 * tests failed is never released.
 *
 * Only GitHub is supported, through the `gh` CLI (no token to configure: it
 * reuses `gh auth login`). Only GitHub Actions check runs count: other apps
 * reporting on the same commit — a Workers Builds preview build, say — are a
 * deployment of their own, not a verdict on the code.
 *
 * Anywhere else (GitLab, no `gh`, not logged in) the answer is "unknown", and
 * the caller says so and goes on: the gate a host enforces itself (a protected
 * deployment branch with required checks) still holds there.
 */
import { execFileSync } from "node:child_process";

export type CheckRun = {
	name: string;
	status: string;
	conclusion: string | null;
	app?: { slug?: string } | null;
};

export type ChecksSummary =
	| { state: "success" | "none" }
	| { state: "pending"; pending: string[] }
	| { state: "failure"; failed: string[] };

/** Conclusions that do not block a release. */
const PASSING = new Set(["success", "skipped", "neutral"]);

export function summarizeChecks(runs: CheckRun[]): ChecksSummary {
	const ours = runs.filter((r) => r.app?.slug === "github-actions");
	if (ours.length === 0) return { state: "none" };
	const failed = ours.filter((r) => r.status === "completed" && !PASSING.has(r.conclusion ?? "")).map((r) => r.name);
	if (failed.length > 0) return { state: "failure", failed };
	const pending = ours.filter((r) => r.status !== "completed").map((r) => r.name);
	if (pending.length > 0) return { state: "pending", pending };
	return { state: "success" };
}

/** `owner/repo` of a GitHub remote URL (ssh or https), or null for any other host. */
export function githubRepo(remoteUrl: string): string | null {
	const m = remoteUrl.trim().match(/^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/(?:[^@/]+@)?github\.com\/)([^/]+\/[^/]+?)(?:\.git)?\/?$/);
	return m ? m[1] : null;
}

/** The check runs of `sha`, or null when they cannot be read (not GitHub, no `gh`, not logged in). */
export function readCheckRuns(sha: string, remote = "origin"): CheckRun[] | null {
	try {
		const url = execFileSync("git", ["remote", "get-url", remote], { encoding: "utf-8" });
		const repo = githubRepo(url);
		if (!repo) return null;
		const out = execFileSync("gh", ["api", `repos/${repo}/commits/${sha}/check-runs?per_page=100`], {
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "ignore"],
		});
		return (JSON.parse(out) as { check_runs: CheckRun[] }).check_runs;
	} catch {
		return null;
	}
}

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

export type CiVerdict = "success" | "failure" | "none" | "unknown" | "timeout";

/**
 * Wait until the GitHub Actions checks of `sha` have finished.
 *
 * `appearWithinMs` covers a commit that was just pushed: its check runs take a
 * few seconds to be created, and "none" before then would mean nothing.
 */
export async function waitForChecks(
	sha: string,
	{ timeoutMs = 30 * 60_000, appearWithinMs = 0, pollMs = 15_000 } = {},
): Promise<{ verdict: CiVerdict; detail: string[] }> {
	const started = Date.now();
	let announced = false;
	for (;;) {
		const runs = readCheckRuns(sha);
		if (!runs) return { verdict: "unknown", detail: [] };
		const summary = summarizeChecks(runs);
		const elapsed = Date.now() - started;
		if (summary.state === "success") return { verdict: "success", detail: [] };
		if (summary.state === "failure") return { verdict: "failure", detail: summary.failed };
		if (summary.state === "none" && elapsed >= appearWithinMs) return { verdict: "none", detail: [] };
		if (elapsed >= timeoutMs) return { verdict: "timeout", detail: summary.state === "pending" ? summary.pending : [] };
		if (!announced && summary.state === "pending") {
			console.log(`Waiting for CI on ${sha.slice(0, 7)} (${summary.pending.join(", ")}) …`);
			announced = true;
		}
		await sleep(pollMs);
	}
}
