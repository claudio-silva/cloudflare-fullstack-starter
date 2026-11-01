#!/usr/bin/env tsx
/**
 * Set up "Sign in with Google" for this project, and check it afterwards.
 *
 * The one step nobody can automate is creating the OAuth client: Google has no
 * public API for a "Web application" client (the IAP OAuth Admin API, the old
 * way round, is being shut down). Everything either side of that visit to the
 * console is what this command does:
 *
 *   1. works out every value to paste — the origins and the redirect URIs of
 *      local, preview and production — and opens the console at the right page;
 *   2. takes the client id and secret, and **verifies** them without a browser:
 *      Google's own authorization endpoint says whether the client exists and
 *      whether each redirect URI is registered, and the token endpoint says
 *      whether the secret is right;
 *   3. writes them into each `.env.<env>`, turns `config.auth.enableGoogleAuth`
 *      on, and offers to sync the secrets to Cloudflare.
 *
 * `--check` does only the verifying, for the credentials already configured —
 * which is what to run after the app's URL changes (a custom domain, or the
 * move to `app.<domain>` when the product website arrives: docs/WEBSITE.md).
 *
 * Scopes are `openid email profile` only, which is what keeps this cheap:
 * Google asks for no verification, shows no warning screen, and applies no
 * hundred-user cap. See docs/GOOGLE_AUTH.md.
 *
 * Usage: npm run setup:google [-- --check] [--client-id <id>] [--client-secret <secret>]
 *                                [--sync] [--yes] [--dry-run]
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { parseEnvFile } from "./lib/deploy-config";
import { fillEnv } from "./lib/setup-ci";
import {
	CONSOLE_BRANDING_URL,
	CONSOLE_CLIENTS_URL,
	TOKEN_URL,
	authorizeProbeUrl,
	looksLikeClientId,
	looksLikeClientSecret,
	origin,
	readAuthorizeAnswer,
	readTokenAnswer,
	redirectUri,
	tokenProbeBody,
} from "./lib/google-oauth";

const USAGE = `Usage: npm run setup:google [-- options]

  --check                    Only verify what is already configured, and report
  --client-id <id>           The OAuth client id (skips the prompt)
  --client-secret <secret>   The OAuth client secret (skips the prompt)
  --sync                     Sync the secrets to Cloudflare afterwards
  --yes, -y                  Do not ask for confirmation
  --dry-run                  Show what would happen; write nothing
  --help, -h`;

type Env = "local" | "preview" | "production";
const ENVIRONMENTS: Env[] = ["local", "preview", "production"];

const packageManager = (process.env.npm_config_user_agent ?? "npm").split("/")[0];

const args = process.argv.slice(2);
const flag = (name: string) => {
	const i = args.indexOf(name);
	return i === -1 ? undefined : args[i + 1];
};
const checkOnly = args.includes("--check");
const dryRun = args.includes("--dry-run");
const yes = args.includes("--yes") || args.includes("-y");
const syncAsked = args.includes("--sync");

function die(message: string): never {
	console.error(`\nsetup:google: ${message}`);
	process.exit(1);
}

const ok = (m: string) => console.log(`  ✓ ${m}`);
const bad = (m: string) => console.log(`  ✗ ${m}`);
const note = (m: string) => console.log(`  · ${m}`);
const change = (m: string) => console.log(`  ${dryRun ? "would" : "→"} ${m}`);

async function ask(question: string, fallback = ""): Promise<string> {
	if (!process.stdin.isTTY) return fallback;
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	const answer = await new Promise<string>((done) => rl.question(`  ${question}${fallback ? ` [${fallback}]` : ""}: `, done));
	rl.close();
	return answer.trim() || fallback;
}

async function confirm(question: string): Promise<boolean> {
	if (yes || !process.stdin.isTTY) return yes;
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	const answer = await new Promise<string>((done) => rl.question(`  ${question} [y/N] `, done));
	rl.close();
	return answer.trim().toLowerCase() === "y";
}

/** The public URL of each environment: its `.env` first, then src/config.ts. */
function baseUrls(root: string): { env: Env; url: string; file: string }[] {
	const source = readFileSync(resolve(root, "src", "config.ts"), "utf-8");
	const block = source.slice(source.indexOf("baseUrls"));
	const fallback = (env: Env) => new RegExp(`${env}:\\s*"([^"]*)"`).exec(block)?.[1] ?? "";
	return ENVIRONMENTS.map((env) => {
		const file = env === "local" ? ".env.local" : `.env.${env}`;
		const url = parseEnvFile(resolve(root, file)).APP_BASE_URL || fallback(env);
		return { env, url, file };
	}).filter((e) => e.url);
}

async function probeRedirect(clientId: string, uri: string): Promise<ReturnType<typeof readAuthorizeAnswer>> {
	try {
		const res = await fetch(authorizeProbeUrl(clientId, uri), { redirect: "manual" });
		return readAuthorizeAnswer(res.status, res.headers.get("location"), await res.text().catch(() => ""));
	} catch {
		return "unclear";
	}
}

async function probeSecret(clientId: string, clientSecret: string, uri: string): Promise<ReturnType<typeof readTokenAnswer>> {
	try {
		const res = await fetch(TOKEN_URL, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: tokenProbeBody(clientId, clientSecret, uri),
		});
		return readTokenAnswer(res.status, (await res.json().catch(() => null)) as { error?: string } | null);
	} catch {
		return "unclear";
	}
}

/** Verify a client against every environment. Returns false when something is certainly wrong. */
async function verify(clientId: string, clientSecret: string, targets: { env: Env; url: string }[]): Promise<boolean> {
	let good = true;
	console.log("\nChecking with Google (nothing is signed in, no browser needed):");

	if (clientSecret) {
		const verdict = await probeSecret(clientId, clientSecret, redirectUri(targets[0].url));
		if (verdict === "ok") {
			ok("the client id and secret are a pair Google accepts");
		} else if (verdict === "wrong-secret") {
			good = false;
			bad("Google refuses this id and secret together — the secret looks wrong");
		} else if (verdict === "unknown-client") {
			good = false;
			bad(`Google does not know the client ${clientId}`);
		} else {
			note("could not tell whether the secret is right (Google answered something unexpected)");
		}
	}

	for (const { env, url } of targets) {
		const uri = redirectUri(url);
		switch (await probeRedirect(clientId, uri)) {
			case "ok":
				ok(`${env}: ${uri} is registered`);
				break;
			case "redirect-mismatch":
				good = false;
				bad(`${env}: ${uri} is NOT registered — add it under "Authorized redirect URIs"`);
				break;
			case "unknown-client":
				good = false;
				bad(`${env}: Google does not know the client ${clientId}`);
				break;
			default:
				note(`${env}: could not check ${uri} (Google answered something unexpected)`);
		}
	}
	return good;
}

function instructions(targets: { env: Env; url: string }[]): void {
	console.log(`\nGoogle has no API for creating a web OAuth client, so this part is a visit to the console.\n`);
	console.log(`  1. Consent screen (once per project):  ${CONSOLE_BRANDING_URL}`);
	console.log(`     External, your app's name, your email. Scopes: leave the defaults —`);
	console.log(`     "openid email profile" need no verification, show no warning and have no user cap.\n`);
	console.log(`  2. Create the client:                  ${CONSOLE_CLIENTS_URL}`);
	console.log(`     Application type: Web application. One client covers every environment.\n`);
	console.log(`     Authorized JavaScript origins:`);
	for (const t of targets) console.log(`       ${origin(t.url)}${" ".repeat(Math.max(1, 40 - origin(t.url).length))}(${t.env})`);
	console.log(`\n     Authorized redirect URIs:`);
	for (const t of targets) console.log(`       ${redirectUri(t.url)}${" ".repeat(Math.max(1, 40 - redirectUri(t.url).length))}(${t.env})`);
	console.log(`\n     A worktree's dev server runs on another port; add its URI too when you use one.\n`);
}

function writeCredentials(root: string, clientId: string, clientSecret: string, targets: { env: Env; file: string }[]): string[] {
	const written: string[] = [];
	for (const { file } of targets) {
		const path = resolve(root, file);
		if (!existsSync(path)) {
			note(`${file} does not exist yet; skipped`);
			continue;
		}
		const filled = fillEnv(readFileSync(path, "utf-8"), { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret }, { overwrite: true });
		if (!filled.changed.length) {
			ok(`${file} already holds these credentials`);
			continue;
		}
		change(`write GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET into ${file}`);
		if (!dryRun) writeFileSync(path, filled.content);
		written.push(file);
	}

	const configPath = resolve(root, "src", "config.ts");
	const source = readFileSync(configPath, "utf-8");
	if (/enableGoogleAuth:\s*true/.test(source)) {
		ok("src/config.ts already has enableGoogleAuth: true");
	} else {
		change("turn enableGoogleAuth on (src/config.ts)");
		if (!dryRun) writeFileSync(configPath, source.replace(/enableGoogleAuth:\s*false/, "enableGoogleAuth: true"));
	}
	return written;
}

async function main(): Promise<void> {
	if (args.includes("--help") || args.includes("-h")) return console.log(USAGE);
	const root = process.cwd();
	if (!existsSync(resolve(root, "src", "config.ts"))) die("run it from the project root");

	const targets = baseUrls(root);
	if (targets.length === 0) die("no base URLs: run `npm run init` first, so the project knows its own addresses");

	const configured = Object.fromEntries(
		targets.map(({ env, file }) => [env, parseEnvFile(resolve(root, file))] as const),
	) as Record<Env, Record<string, string>>;
	const known = targets.map(({ env }) => configured[env]).find((e) => e.GOOGLE_CLIENT_ID) ?? {};

	if (checkOnly) {
		if (!known.GOOGLE_CLIENT_ID) die("no GOOGLE_CLIENT_ID in any .env file; run it without --check to set one up");
		console.log(`Google sign-in, as this project is configured:\n  client ${known.GOOGLE_CLIENT_ID}`);
		const good = await verify(known.GOOGLE_CLIENT_ID, known.GOOGLE_CLIENT_SECRET ?? "", targets);
		for (const { env, file } of targets) {
			const creds = configured[env];
			if (!creds.GOOGLE_CLIENT_ID || !creds.GOOGLE_CLIENT_SECRET) note(`${env}: ${file} has no credentials, so Google sign-in is off there`);
			else if (creds.GOOGLE_CLIENT_ID !== known.GOOGLE_CLIENT_ID) note(`${env}: ${file} uses a different client (${creds.GOOGLE_CLIENT_ID})`);
		}
		if (!good) process.exitCode = 1;
		return;
	}

	console.log(`Google sign-in for this project:\n`);
	for (const { env, url } of targets) console.log(`  ${env.padEnd(11)}${origin(url)}`);
	instructions(targets);

	const clientId = flag("--client-id") ?? (await ask("Client ID", known.GOOGLE_CLIENT_ID ?? ""));
	if (!clientId) die("no client id given");
	if (!looksLikeClientId(clientId)) note("that does not look like a Google client id (…apps.googleusercontent.com) — checking it anyway");
	const clientSecret = flag("--client-secret") ?? (await ask("Client secret", known.GOOGLE_CLIENT_SECRET ?? ""));
	if (!clientSecret) die("no client secret given");
	if (!looksLikeClientSecret(clientSecret)) note("that does not look like a Google client secret — checking it anyway");

	const good = await verify(clientId, clientSecret, targets);
	if (!good && !(await confirm("\nSomething above is wrong. Write the credentials anyway?"))) {
		die("nothing was written. Fix it in the console and run this again.");
	}

	console.log("");
	const written = writeCredentials(root, clientId, clientSecret, targets);

	if (dryRun) return console.log("\n(dry run — nothing was written)");

	const remote = written.filter((f) => f !== ".env.local");
	if (remote.length && (syncAsked || (await confirm(`\nSync the new secrets to Cloudflare (${remote.join(", ")})?`)))) {
		for (const file of remote) {
			const env = file.replace(".env.", "");
			console.log(`  $ npx tsx bin/sync-secrets.ts ${env}`);
			execFileSync("npx", ["tsx", "bin/sync-secrets.ts", env], { stdio: "inherit" });
		}
	} else if (remote.length) {
		console.log(`\nSync them when you are ready:  ${remote.map((f) => `npx tsx bin/sync-secrets.ts ${f.replace(".env.", "")}`).join("  ·  ")}`);
	}

	console.log(`\n✅ Google sign-in is configured. The button appears wherever the Worker has both credentials.`);
	console.log(`   Locally: ${packageManager} run dev, then open the sign-in page.`);
	console.log(`   After the app's URL ever changes:  ${packageManager} run setup:google -- --check`);
}

main().catch((error: unknown) => die(error instanceof Error ? error.message : String(error)));
