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

import { execSync } from "child_process";
import { createHash } from "crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const HASH_DIR = ".wrangler/secrets";

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
			// Only sync non-empty values that look like secrets (not config)
			// Skip VITE_ prefixed vars (client-side only) and ENVIRONMENT (in wrangler.toml)
			if (value && !key.startsWith("VITE_") && key !== "ENVIRONMENT") {
				secrets[key] = value;
			}
		}
	}

	return secrets;
}

function syncSecret(key: string, value: string, env: string): boolean {
	try {
		// Use echo to pipe the value to wrangler secret put
		execSync(`echo "${value}" | wrangler secret put ${key} --env ${env}`, {
			stdio: ["pipe", "pipe", "pipe"],
		});
		return true;
	} catch (error) {
		console.error(`  ✗ Failed to sync ${key}`);
		return false;
	}
}

function main() {
	const args = process.argv.slice(2);

	if (args.length === 0) {
		console.error("Usage: tsx bin/sync-secrets.ts <environment>");
		console.error("Example: tsx bin/sync-secrets.ts production");
		process.exit(1);
	}

	const env = args[0];
	const envFile = getEnvFilePath(env);

	// Check if env file exists
	if (!existsSync(envFile)) {
		console.log(`No ${envFile} file found, skipping secrets sync.`);
		process.exit(0);
	}

	// Compute current hash
	const currentHash = computeFileHash(envFile);
	const storedHash = getStoredHash(env);

	// Check if file has changed
	if (currentHash === storedHash) {
		console.log(`✓ Secrets for ${env} are up to date (no changes detected)`);
		process.exit(0);
	}

	console.log(`Syncing secrets from ${envFile} to Cloudflare...`);

	// Parse secrets from env file
	const secrets = parseEnvFile(envFile);
	const secretKeys = Object.keys(secrets);

	if (secretKeys.length === 0) {
		console.log(`  No secrets found in ${envFile}`);
		storeHash(env, currentHash);
		process.exit(0);
	}

	console.log(`  Found ${secretKeys.length} secret(s): ${secretKeys.join(", ")}`);

	// Sync each secret
	let allSuccess = true;
	for (const [key, value] of Object.entries(secrets)) {
		process.stdout.write(`  Syncing ${key}... `);
		if (syncSecret(key, value, env)) {
			console.log("✓");
		} else {
			allSuccess = false;
		}
	}

	if (allSuccess) {
		// Store the new hash
		storeHash(env, currentHash);
		console.log(`✓ All secrets synced successfully`);
	} else {
		console.error("✗ Some secrets failed to sync");
		process.exit(1);
	}
}

main();
