/**
 * Make sure a push to a Workers Builds branch started a build.
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

/** Returns how the build started: "push" (the webhook did it), "api" (started here), or "unknown" (could not tell). */
export async function ensureBuildStarted(o: EnsureBuildOptions): Promise<"push" | "api" | "unknown"> {
	const { token, accountId, workerName, branch, pushedAt, graceMs = 120_000, log = console.log } = o;
	const scripts = await cf<{ id: string; tag?: string }[]>(token, "GET", `/accounts/${accountId}/workers/scripts`);
	const tag = scripts.find((s) => s.id === workerName)?.tag;
	if (!tag) return "unknown";
	const trigger = (await cf<Trigger[]>(token, "GET", `/accounts/${accountId}/builds/workers/${tag}/triggers`)).find((t) => t.branch_includes.includes(branch));
	if (!trigger) return "unknown";

	// Clocks differ a little; a build of another branch is not ours.
	const since = pushedAt.getTime() - 30_000;
	const started = async () =>
		(await cf<Build[]>(token, "GET", `/accounts/${accountId}/builds/workers/${tag}/builds?per_page=5`)).some(
			(b) => Date.parse(b.created_on) >= since && (b.build_trigger_metadata?.branch ?? branch) === branch,
		);

	const deadline = Date.now() + graceMs;
	while (Date.now() < deadline) {
		if (await started()) return "push";
		await new Promise((done) => setTimeout(done, 10_000));
	}
	if (await started()) return "push";
	log(`  Workers Builds started no build for the push to ${branch} (its webhook was lost); starting it through the API.`);
	await cf(token, "POST", `/accounts/${accountId}/builds/triggers/${trigger.trigger_uuid}/builds`, { branch });
	return "api";
}
