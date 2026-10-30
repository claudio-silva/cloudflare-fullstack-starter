/**
 * Make sure a push to a Workers Builds branch started a build, and follow it.
 *
 * Workers Builds starts builds from GitHub's push webhook, and a webhook can
 * be lost: the push lands, nothing builds, and nothing says so. Seen once on
 * a release, not reproducible after. A release that waits for its version
 * would then time out with the right commit on the branch and no deploy, so
 * `deploy:production` asks Cloudflare whether a build started and, after a
 * grace period, starts one itself through the API — the same build the push
 * would have started (the branch's head).
 */
import { cf } from "./cloudflare-api";

type Build = { build_uuid: string; created_on: string; build_trigger_metadata?: { branch?: string; commit_hash?: string } };
type Trigger = { trigger_uuid: string; branch_includes: string[] };

export type EnsureBuildOptions = {
	token: string;
	accountId: string;
	workerName: string;
	branch: string;
	/** When the branch was pushed: a build created since is the push's. */
	pushedAt: Date;
	graceMs?: number;
	log?: (message: string) => void;
};

export type StartedBuild = { how: "push" | "api"; buildId: string | null } | { how: "unknown"; buildId: null };

/** Says how the build started: "push" (the webhook did it), "api" (started here), or "unknown" (could not tell); and which build it is, to follow it. */
export async function ensureBuildStarted(o: EnsureBuildOptions): Promise<StartedBuild> {
	const { token, accountId, workerName, branch, pushedAt, graceMs = 120_000, log = console.log } = o;
	const scripts = await cf<{ id: string; tag?: string }[]>(token, "GET", `/accounts/${accountId}/workers/scripts`);
	const tag = scripts.find((s) => s.id === workerName)?.tag;
	if (!tag) return { how: "unknown", buildId: null };
	const trigger = (await cf<Trigger[]>(token, "GET", `/accounts/${accountId}/builds/workers/${tag}/triggers`)).find((t) => t.branch_includes.includes(branch));
	if (!trigger) return { how: "unknown", buildId: null };

	// Clocks differ a little; a build of another branch is not ours.
	const since = pushedAt.getTime() - 30_000;
	const started = async () =>
		(await cf<Build[]>(token, "GET", `/accounts/${accountId}/builds/workers/${tag}/builds?per_page=5`)).find(
			(b) => Date.parse(b.created_on) >= since && (b.build_trigger_metadata?.branch ?? branch) === branch,
		);

	const deadline = Date.now() + graceMs;
	while (Date.now() < deadline) {
		const build = await started();
		if (build) return { how: "push", buildId: build.build_uuid };
		await sleep(10_000);
	}
	const late = await started();
	if (late) return { how: "push", buildId: late.build_uuid };
	log(`  Workers Builds started no build for the push to ${branch} (its webhook was lost); starting it through the API.`);
	const build = await cf<Build | undefined>(token, "POST", `/accounts/${accountId}/builds/triggers/${trigger.trigger_uuid}/builds`, { branch });
	let buildId = build?.build_uuid ?? null;
	for (let i = 0; !buildId && i < 6; i++) {
		await sleep(5_000);
		buildId = (await started())?.build_uuid ?? null;
	}
	return { how: "api", buildId };
}

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** What the build's own steps print (bin/deploy-pipeline.ts, bin/db.ts): shown as they happen. The rest is npm and wrangler. */
const PIPELINE_LINE = /^(\s*\$ |✓|✗|Deploying |Pending |Applied: |Nothing to apply|First deploy )/;
/** Vite's own ticks, which look like the pipeline's. */
const BUILD_NOISE = /^✓ (\d+ modules transformed|built in )/;

/** The build's phases, as Workers Builds names them. */
const PHASES: Record<string, string> = {
	initializing: "starting",
	cloning: "cloning",
	installing_tools_and_deps: "installing",
	building: "building",
	deploying: "deploying (bin/deploy-pipeline.ts)",
};

export type FollowBuildOptions = {
	token: string;
	accountId: string;
	buildId: string;
	timeoutMs?: number;
	pollMs?: number;
	log?: (message: string) => void;
};

/**
 * Follows a build to its end, showing its phases and the pipeline's steps,
 * and says how it ended. A release is not over when the Worker serves the new
 * version: the build goes on to migrate and close the maintenance window.
 * On failure, `tail` holds the last lines of its log.
 */
export async function followBuild(o: FollowBuildOptions): Promise<{ outcome: string; tail: string[] }> {
	const { token, accountId, buildId, timeoutMs = 20 * 60_000, pollMs = 5_000, log = console.log } = o;
	const lines: string[] = [];
	const phases = new Set<string>();
	let cursor: string | undefined;
	let failed = false;
	const readLog = async () => {
		const page = await cf<{ lines?: [number, string][]; cursor?: string; events?: { type: string }[] }>(
			token,
			"GET",
			`/accounts/${accountId}/builds/builds/${buildId}/logs${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
		);
		cursor = page.cursor ?? cursor;
		for (const { type } of page.events ?? []) {
			if (phases.has(type)) continue;
			phases.add(type);
			log(`  Workers Builds: ${PHASES[type] ?? type}`);
		}
		for (const [, line] of page.lines ?? []) {
			lines.push(line);
			// After a failure every line counts: it is the explanation.
			if (line.startsWith("✗")) failed = true;
			if (failed || (PIPELINE_LINE.test(line) && !BUILD_NOISE.test(line))) log(`    ${line}`);
		}
	};

	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const build = await cf<{ status: string; build_outcome: string | null }>(token, "GET", `/accounts/${accountId}/builds/builds/${buildId}`);
		await readLog().catch(() => undefined);
		if (build.status === "stopped") {
			await readLog().catch(() => undefined);
			return { outcome: build.build_outcome ?? "unknown", tail: lines.slice(-25) };
		}
		await sleep(pollMs);
	}
	return { outcome: "timeout", tail: lines.slice(-25) };
}
