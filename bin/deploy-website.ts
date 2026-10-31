#!/usr/bin/env tsx
/**
 * Deploy the product website — only the website.
 *
 * It is a Worker of its own, so it deploys on its own: no build (the site is
 * static files), no migrations, no release tag, nothing of the app's. That is
 * also why it is NOT part of `deploy:preview` / `deploy:production`: a change
 * to the app has no reason to put the marketing site through a deploy, and the
 * site is what should stay up when the app's pipeline is the problem.
 *
 * `deploy:all:<env>` runs both, the app first.
 *
 * Usage: tsx bin/deploy-website.ts --env <preview|production> [--yes] [--dry-run]
 */
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { requireWebsiteConfig } from "./lib/website-config";
import { resolveWorkerName } from "./lib/worker";

type Env = "preview" | "production";

function die(message: string): never {
	console.error(`deploy:website: ${message}`);
	process.exit(1);
}

async function confirm(question: string): Promise<boolean> {
	if (!process.stdin.isTTY) return false;
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	const answer = await new Promise<string>((done) => rl.question(`${question} [y/N] `, done));
	rl.close();
	return answer.trim().toLowerCase() === "y";
}

/** Deploy the website Worker of `env`. Exported so `deploy:production` can run it in line. */
export async function deployWebsite(env: Env, { yes = false, dryRun = false } = {}): Promise<void> {
	const website = requireWebsiteConfig();
	const config = `${website.dir}/wrangler.toml`;
	const workerName = resolveWorkerName(config, env);
	const hostname = website.hosts[env];

	console.log(`Website → ${env}: Worker ${workerName}${hostname ? ` (https://${hostname})` : ""}`);
	if (dryRun) {
		execFileSync("npx", ["wrangler", "deploy", "--dry-run", "--config", config, "--env", env], { stdio: "inherit" });
		return console.log("(dry run — nothing deployed)");
	}
	// Production is never deployed without someone saying so.
	if (env === "production" && !yes && !(await confirm(`Deploy the website to production (${hostname || workerName})?`))) {
		die("aborted");
	}
	execFileSync("npx", ["wrangler", "deploy", "--config", config, "--env", env], { stdio: "inherit" });
	console.log(`✓ website deployed to ${env}.`);

	if (!hostname) return;
	// Answering is the only health check a static site needs; a hostname that
	// is not attached yet simply does not answer, which is worth saying once.
	try {
		const response = await fetch(`https://${hostname}/`, { cache: "no-store" });
		console.log(response.ok ? `✓ https://${hostname} answers (${response.status})` : `  https://${hostname} answers ${response.status}`);
	} catch {
		console.log(`  https://${hostname} does not answer yet. Attach it with: npm run setup:domain -- ${hostname} --env ${env} --website`);
	}
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const index = args.indexOf("--env");
	const env = (index === -1 ? "preview" : args[index + 1]) as Env;
	if (env !== "preview" && env !== "production") die("--env takes preview or production");
	await deployWebsite(env, { yes: args.includes("--yes") || args.includes("-y"), dryRun: args.includes("--dry-run") });
}

if (process.argv[1]?.endsWith("deploy-website.ts")) {
	main().catch((error: unknown) => die(error instanceof Error ? error.message : String(error)));
}
