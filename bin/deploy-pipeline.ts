#!/usr/bin/env tsx
/**
 * The deploy itself: build, migrate, deploy, migrate. Run locally by
 * `deploy-production` in `manual` mode (or with `--local`), and by CI in the
 * other two modes — one sequence, so a CI deploy and a laptop deploy cannot
 * drift apart.
 *
 * Order is not a style choice. It follows from expand/contract:
 *
 *   migrate expand     ← before the deploy: the old code ignores new columns
 *   wrangler deploy
 *   migrate contract   ← after it: the new code no longer uses them
 *
 * Putting every migration after the deploy, as earlier versions did, runs the
 * new code against the old schema — the one direction that reliably breaks.
 *
 * A `breaking` migration cannot be made to fit either order, so it gets a
 * window instead:
 *
 *   wrangler deploy --var MAINTENANCE:1   ← app answers 503 in place
 *   migrate
 *   wrangler deploy                        ← var gone, app back
 *
 * The window is a Worker var rather than the zone-level redirect because the
 * var keeps the URL, returns a real 503 with Retry-After, and lets the client
 * replay the request (src/react-app/lib/http/maintenance.ts). It needs a deploy to
 * flip, which is free here: we are deploying anyway. The zone redirect stays
 * for emergencies, where the Worker may be the thing that is broken.
 *
 * If anything fails the window stays OPEN on purpose, so nobody reaches a
 * half-migrated database, and a report goes out by email.
 *
 * Usage:
 *   tsx bin/deploy-pipeline.ts --env <preview|production> [--skip-build] [--dry-run]
 */

import { execFileSync } from "node:child_process";
import { connectToDatabase } from "../src/cli/utils/db";
import { loadDeployConfig, type DeployEnv } from "./lib/deploy-config";
import { resolveBuildInfo } from "./lib/build-info";
import type { MigrationStatus } from "../src/shared/migration-types";

type Stage = "build" | "migrate-expand" | "migrate-breaking" | "deploy" | "migrate-contract";

const isCi = () => Boolean(process.env.WORKERS_CI || process.env.CI);

function run(command: string, args: string[]): void {
	console.log(`  $ ${command} ${args.join(" ")}`);
	execFileSync(command, args, { stdio: "inherit" });
}

/** Deploy the current build, optionally with the app taken out of service. */
function deployWorker(inMaintenance: boolean): void {
	run("npx", inMaintenance ? ["wrangler", "deploy", "--var", "MAINTENANCE:1"] : ["wrangler", "deploy"]);
}

/** Compare `vX.Y.Z` style versions, ignoring any build metadata. */
function compareVersions(a: string, b: string): number {
	const parse = (v: string) => v.replace(/^v/, "").split("+")[0].split(".").map(Number);
	const [a1, a2, a3] = parse(a);
	const [b1, b2, b3] = parse(b);
	return a1 - b1 || a2 - b2 || a3 - b3;
}

async function liveVersion(env: DeployEnv): Promise<string | null> {
	const { getApiBaseUrl } = await import("../src/cli/utils/db");
	try {
		const body = (await (await fetch(`${getApiBaseUrl(env)}/api/`)).json()) as { version?: string };
		return body.version ?? null;
	} catch {
		return null;
	}
}

async function reportFailure(env: DeployEnv, stage: Stage, error: unknown): Promise<void> {
	const { version } = resolveBuildInfo();
	try {
		// Connecting first is what loads .env.<env> into process.env, which is
		// where CLI_API_KEY comes from outside CI.
		await connectToDatabase(env);
		const { getApiBaseUrl } = await import("../src/cli/utils/db");
		const res = await fetch(`${getApiBaseUrl(env)}/api/cli/deploy-report`, {
			method: "POST",
			headers: { "Content-Type": "application/json", "x-api-key": process.env.CLI_API_KEY ?? "" },
			body: JSON.stringify({ environment: env, version, stage, error: String(error) }),
		});
		const body = (await res.json().catch(() => ({}))) as { sent?: boolean; reason?: string };
		console.error(body.sent ? "  (failure report sent by email)" : `  (no email report: ${body.reason ?? "unknown"})`);
	} catch {
		console.error("  (could not send the failure report; the CI failure is still the signal)");
	}
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const envIdx = args.indexOf("--env");
	const env = (envIdx === -1 ? "production" : args[envIdx + 1]) as DeployEnv;
	if (env !== "preview" && env !== "production") throw new Error(`Unknown environment "${env}"`);

	// CI deploys switched off (deploy.config.ts mode "manual"). Ends green, so a
	// CI that runs this without bin/ci-deploy-guard.ts first does not fail.
	if (isCi() && loadDeployConfig(env).mode === "manual") {
		console.log('CI deploys are OFF: deploy.config.ts has mode "manual". Nothing was deployed.');
		return;
	}
	const skipBuild = args.includes("--skip-build");
	const dryRun = args.includes("--dry-run");

	const client = await connectToDatabase(env);
	const pending: MigrationStatus[] = (await client.migrations()).filter((m) => !m.applied);
	const byKind = (kind: string) => pending.filter((m) => m.compatibility === kind);
	const breaking = byKind("breaking");
	const contract = byKind("contract");

	console.log(`Deploying ${env}`);
	console.log(
		pending.length === 0
			? "  Pending migrations: none"
			: `  Pending migrations: ${pending.map((m) => `${m.name} (${m.compatibility})`).join(", ")}`,
	);

	// A contract migration that lands before the release which stopped using the
	// column is the classic outage. The check turns that from discipline into
	// something the pipeline refuses to get wrong.
	if (contract.length > 0) {
		const live = await liveVersion(env);
		for (const m of contract) {
			if (!m.safeSince) throw new Error(`${m.name} is "contract" but declares no safeSince.`);
			if (live && compareVersions(live, m.safeSince) < 0) {
				throw new Error(
					`${m.name} needs production to be at least ${m.safeSince}, but ${env} serves ${live}. ` +
						"Ship that release first, then this migration.",
				);
			}
		}
	}

	const needsWindow = breaking.length > 0;
	console.log(
		needsWindow
			? `  Maintenance window: YES — MAINTENANCE=1 while ${breaking.map((m) => m.name).join(", ")} runs`
			: "  Maintenance window: no (nothing breaking)",
	);
	if (dryRun) {
		console.log("(dry run — nothing changed)");
		return;
	}

	let stage: Stage = "build";
	try {
		if (!skipBuild) {
			// CI builds before this runs; locally we also push secrets and build vars.
			if (!isCi()) {
				run("npx", ["tsx", "bin/sync-secrets.ts", env]);
				run("npx", ["tsx", "bin/sync-build-vars.ts", env]);
			}
			run("npm", ["run", `build:${env}`]);
		}

		if (needsWindow) {
			// Take the app down first: a breaking migration suits neither order,
			// so everything happens behind the window.
			stage = "deploy";
			deployWorker(true);

			stage = "migrate-breaking";
			run("npx", ["tsx", "bin/db.ts", "migrate", "--env", env, "--safe", "--only", "expand"]);
			run("npx", ["tsx", "bin/db.ts", "migrate", "--env", env, "--safe", "--only", "breaking"]);

			stage = "deploy";
			deployWorker(false);
		} else {
			stage = "migrate-expand";
			run("npx", ["tsx", "bin/db.ts", "migrate", "--env", env, "--safe", "--only", "expand"]);

			stage = "deploy";
			deployWorker(false);
		}

		if (contract.length > 0) {
			stage = "migrate-contract";
			run("npx", [
				"tsx",
				"bin/db.ts",
				"migrate",
				"--env",
				env,
				"--safe",
				"--wait-for-deploy",
				"--only",
				"contract",
			]);
		}
	} catch (error) {
		console.error(`\n✗ Deploy to ${env} failed at "${stage}".`);
		if (needsWindow) {
			console.error("  The app is still in maintenance, on purpose: nobody reaches a half-migrated");
			console.error(`  database. Inspect with: npm run db -- journal --env ${env}`);
			console.error("  Bring it back with:     npx wrangler deploy   (without --var MAINTENANCE:1)");
		}
		await reportFailure(env, stage, error);
		process.exit(1);
	}

	console.log(`✓ ${env} deployed.`);
}

main().catch((error: unknown) => {
	console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
});
