#!/usr/bin/env tsx
/**
 * Sync secrets from .env.<environment> files to Cloudflare Workers secrets.
 *
 * This script:
 * 1. Reads the .env.<env> file (e.g., .env.production)
 * 2. Compares a hash of the file with a stored hash to detect changes
 * 3. If changed, parses the file and calls `wrangler secret put` for each secret
 * 4. Stores the new hash after successful sync
 *
 * Usage:
 *   tsx bin/sync-secrets.ts <environment>
 *   tsx bin/sync-secrets.ts production
 *   tsx bin/sync-secrets.ts preview
 */

import { spawnSync } from "child_process";
import { createHash } from "crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const HASH_DIR = ".wrangler/secrets";
const NON_SECRET_KEYS = new Set([
	"ENVIRONMENT",
	"EMAIL_PROVIDER",
	"AUTH_EMAILS_LOCAL_ENABLED",
]);
// Cloudflare aggressively rate-limits `wrangler secret put`. A short pause
// between successive puts noticeably reduces 429s on bursts of >5 secrets.
const SECRET_PUT_DELAY_MS = 350;

function getEnvFilePath(env: string): string {
	return `.env.${env}`;
}

function getHashFilePath(env: string): string {
	return join(HASH_DIR, `${env}.hash`);
}

function computeFileHash(filePath: string): string {
	const content = readFileSync(filePath, "utf-8");
	return createHash("sha256").update(content).digest("hex");
}

function getStoredHash(env: string): string | null {
	const hashFile = getHashFilePath(env);
	if (existsSync(hashFile)) {
		return readFileSync(hashFile, "utf-8").trim();
	}
	return null;
}

function storeHash(env: string, hash: string): void {
	const hashFile = getHashFilePath(env);
	mkdirSync(HASH_DIR, { recursive: true });
	writeFileSync(hashFile, hash);
}

function parseEnvFile(filePath: string): Record<string, string> {
	const content = readFileSync(filePath, "utf-8");
	const secrets: Record<string, string> = {};

	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		// Skip empty lines and comments
		if (!trimmed || trimmed.startsWith("#")) continue;

		const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
		if (match) {
			const [, key, rawValue] = match;
			// Remove surrounding quotes if present
			let value = rawValue;
			if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
				value = value.slice(1, -1);
			}
			// Only sync non-empty values that look like secrets (not config).
			// Skip VITE_ prefixed vars (client-side only) and config vars kept in wrangler.toml.
			if (value && !key.startsWith("VITE_") && !NON_SECRET_KEYS.has(key)) {
				secrets[key] = value;
			}
		}
	}

	return secrets;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function syncSecret(key: string, value: string, env: string): boolean {
	// Pipe the value via stdin (not a shell `echo`) so secrets containing `$`,
	// backticks, quotes or newlines are passed verbatim and not interpreted by
	// the shell. Capture stderr so the real wrangler error is surfaced on
	// failure instead of being silently dropped.
	const result = spawnSync("wrangler", ["secret", "put", key, "--env", env], {
		input: value,
		encoding: "utf-8",
		stdio: ["pipe", "pipe", "pipe"],
	});
	if (result.status === 0) {
		return true;
	}
	const detail = (result.stderr || result.stdout || result.error?.message || "").trim();
	console.error(`\n  ✗ Failed to sync ${key}${detail ? `:\n${detail.replace(/^/gm, "    ")}` : ""}`);
	return false;
}

async function main() {
	const args = process.argv.slice(2);

	if (args.length === 0) {
		console.error("Usage: tsx bin/sync-secrets.ts <environment>");
		console.error("Example: tsx bin/sync-secrets.ts production");
		process.exit(1);
	}

	const env = args[0];
	const envFile = getEnvFilePath(env);

	if (!existsSync(envFile)) {
		console.log(`No ${envFile} file found, skipping secrets sync.`);
		process.exit(0);
	}

	const currentHash = computeFileHash(envFile);
	const storedHash = getStoredHash(env);

	if (currentHash === storedHash) {
		console.log(`✓ Secrets for ${env} are up to date (no changes detected)`);
		process.exit(0);
	}

	console.log(`Syncing secrets from ${envFile} to Cloudflare...`);

	const secrets = parseEnvFile(envFile);
	const secretKeys = Object.keys(secrets);

	if (secretKeys.length === 0) {
		console.log(`  No secrets found in ${envFile}`);
		storeHash(env, currentHash);
		process.exit(0);
	}

	console.log(`  Found ${secretKeys.length} secret(s): ${secretKeys.join(", ")}`);

	const entries = Object.entries(secrets);
	let allSuccess = true;
	for (let i = 0; i < entries.length; i++) {
		const [key, value] = entries[i];
		process.stdout.write(`  Syncing ${key}... `);
		if (syncSecret(key, value, env)) {
			console.log("✓");
		} else {
			allSuccess = false;
		}
		if (i < entries.length - 1) {
			await sleep(SECRET_PUT_DELAY_MS);
		}
	}

	if (allSuccess) {
		storeHash(env, currentHash);
		console.log(`✓ All secrets synced successfully`);
	} else {
		console.error("✗ Some secrets failed to sync");
		process.exit(1);
	}
}

main().catch((err) => {
	console.error("Unexpected error:", err);
	process.exit(1);
});
