#!/usr/bin/env tsx
/**
 * Serve an environment on your own domain, with or without CI:
 *
 *   1. finds the hostname's zone on your Cloudflare account;
 *   2. attaches the hostname to the environment's Worker (Cloudflare creates
 *      the DNS record and the certificate), and waits until it answers;
 *   3. records it in wrangler.toml, so every later deploy keeps it;
 *   4. makes it the app's URL (APP_BASE_URL, CLI_API_URL_<ENV> in
 *      .env.<env>) and syncs that to Cloudflare.
 * Nothing is deployed: the running version serves the new hostname at once.
 * Safe to run again; each step checks first. See bin/lib/custom-domain.ts.
 *
 * The zone must already be on the account (dashboard → Add a domain), and the
 * hostname free of DNS records. Credentials: CLOUDFLARE_API_TOKEN from the
 * environment or .env.setup.local, else wrangler's own login (`npx wrangler login`).
 *
 * Usage: npm run setup:domain -- <hostname> [--env production|preview] [--yes] [--dry-run]
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { deployConfig } from "../deploy.config";
import { cf } from "./lib/cloudflare-api";
import { attachCustomDomain, normalizeHostname } from "./lib/custom-domain";
import { cloudflareCredentials } from "./lib/deploy-config";
import { resolveWorkerName, workerExists } from "./lib/worker";

const USAGE = "Usage: npm run setup:domain -- <hostname> [--env production|preview] [--yes] [--dry-run]";
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const yes = args.includes("--yes") || args.includes("-y");
const envIndex = args.indexOf("--env");
const env = envIndex === -1 ? "production" : args[envIndex + 1];
const input = args.find((a, i) => !a.startsWith("-") && (envIndex === -1 || i !== envIndex + 1));

function die(message: string): never {
	console.error(`\nsetup:domain: ${message}`);
	process.exit(1);
}

/** The API token to use: the one set up for the deploy scripts, or wrangler's login. */
function apiToken(): string {
	const { token } = cloudflareCredentials();
	if (token) return token;
	try {
		const out = execFileSync("npx", ["wrangler", "auth", "token", "--json"], { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
		return (JSON.parse(out) as { token?: string }).token ?? "";
	} catch {
		return "";
	}
}

async function accountId(token: string): Promise<string> {
	const { accountId: configured } = cloudflareCredentials();
	if (configured) return configured;
	const accounts = await cf<{ id: string; name: string }[]>(token, "GET", "/accounts");
	if (accounts.length === 1) return accounts[0].id;
	return die(`these credentials reach ${accounts.length} accounts; pick one with CLOUDFLARE_ACCOUNT_ID=<id> (or in .env.setup.local):\n${accounts.map((a) => `  ${a.id}  ${a.name}`).join("\n")}`);
}

async function confirm(question: string): Promise<boolean> {
	if (yes) return true;
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	const answer = await new Promise<string>((done) => rl.question(`${question} [y/N] `, done));
	rl.close();
	return answer.trim().toLowerCase() === "y";
}

async function main(): Promise<void> {
	if (args.includes("--help") || args.includes("-h")) return console.log(USAGE);
	if (!input) die(USAGE);
	if (env !== "production" && env !== "preview") die("--env takes production or preview");
	if (!existsSync("wrangler.toml")) die("run it from the project root");
	const hostname = normalizeHostname(input) ?? die(`"${input}" is not a hostname (example: app.example.com)`);

	const token = apiToken() || die("no Cloudflare credentials: run `npx wrangler login`, or set CLOUDFLARE_API_TOKEN in .env.setup.local.");
	const account = await accountId(token);
	const workerName = resolveWorkerName("wrangler.toml", env);
	process.env.CLOUDFLARE_ACCOUNT_ID ||= account;
	if (workerExists(workerName) === false) die(`the Worker ${workerName} does not exist yet: deploy ${env} once first.`);

	console.log(`${dryRun ? "Dry run: nothing is changed.\n" : ""}${env}: https://${hostname} → Worker ${workerName}`);
	if (!dryRun && !(await confirm(`The app's URL becomes https://${hostname}; sign-in then works only there. Go ahead?`))) die("aborted");

	const zone = await attachCustomDomain({
		token,
		accountId: account,
		env,
		hostname,
		workerName,
		dryRun,
		report: {
			ok: (m) => console.log(`  ✓ ${m}`),
			note: (m) => console.log(`  · ${m}`),
			change: (m) => console.log(`  ${dryRun ? "would" : "→"} ${m}`),
		},
	});

	if (dryRun) return;
	console.log(`\nhttps://${hostname} is the ${env} app's URL. Commit wrangler.toml, so every deploy keeps the domain.`);
	if (!deployConfig.maintenance.zoneId) {
		console.log(`For an emergency maintenance window (deploy.config.ts → maintenance), the zone id is ${zone.id}.`);
	}
}

main().catch((error: unknown) => die(error instanceof Error ? error.message : String(error)));
