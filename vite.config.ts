import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare, type WorkerConfig } from "@cloudflare/vite-plugin";
import path from "path";
import fs from "node:fs";

function extractEnvRoutes(
	content: string,
	env: "preview" | "production",
): NonNullable<WorkerConfig["routes"]> | undefined {
	const envTag = env === "preview" ? "[env.preview]" : "[env.production]";
	const varsTag = env === "preview" ? "[env.preview.vars]" : "[env.production.vars]";
	const start = content.indexOf(envTag);
	if (start === -1) return undefined;
	const afterHeader = content.slice(start + envTag.length);
	const varsIdx = afterHeader.indexOf(varsTag);
	const block = varsIdx === -1 ? afterHeader : afterHeader.slice(0, varsIdx);
	const routesMatch = block.match(/routes\s*=\s*\[([\s\S]*?)\]/);
	if (!routesMatch) return undefined;
	const inner = routesMatch[1];
	const routes: NonNullable<WorkerConfig["routes"]> = [];
	const entryRe = /\{\s*pattern\s*=\s*"([^"]+)"\s*,\s*custom_domain\s*=\s*(true|false)\s*\}/g;
	let m: RegExpExecArray | null;
	while ((m = entryRe.exec(inner)) !== null) {
		routes.push({ pattern: m[1], custom_domain: m[2] === "true" });
	}
	return routes.length ? routes : undefined;
}

function extractKvRateId(content: string, env: "preview" | "production"): string | undefined {
	const envTag = `[[env.${env}.kv_namespaces]]`;
	if (!content.includes(envTag)) return undefined;
	const re = new RegExp(
		`\\[\\[env\\.${env}\\.kv_namespaces\\]\\][\\s\\S]*?binding\\s*=\\s*"KV_RATE"[\\s\\S]*?id\\s*=\\s*"([^"]+)"`,
	);
	return content.match(re)?.[1];
}

function extractEnvVars(
	content: string,
	env: "preview" | "production",
): Record<string, string> | undefined {
	const header = `[env.${env}.vars]`;
	const start = content.indexOf(header);
	if (start === -1) return undefined;
	const after = content.slice(start + header.length);
	const nextHeader = after.search(/\n\[/);
	const block = nextHeader === -1 ? after : after.slice(0, nextHeader);
	const vars: Record<string, string> = {};
	const re = /^[ \t]*([A-Z_][A-Z0-9_]*)\s*=\s*"([^"]*)"\s*$/gm;
	let m: RegExpExecArray | null;
	while ((m = re.exec(block)) !== null) {
		vars[m[1]] = m[2];
	}
	return Object.keys(vars).length ? vars : undefined;
}

function extractCrons(
	content: string,
	env: "preview" | "production",
): string[] | undefined {
	const header = `[env.${env}.triggers]`;
	const start = content.indexOf(header);
	if (start === -1) return undefined;
	const after = content.slice(start + header.length);
	const nextHeader = after.search(/\n\[/);
	const block = nextHeader === -1 ? after : after.slice(0, nextHeader);
	const cronsMatch = block.match(/crons\s*=\s*\[([\s\S]*?)\]/);
	if (!cronsMatch) return undefined;
	const items: string[] = [];
	const itemRe = /"([^"]+)"/g;
	let m: RegExpExecArray | null;
	while ((m = itemRe.exec(cronsMatch[1])) !== null) {
		items.push(m[1]);
	}
	return items.length ? items : undefined;
}

function extractR2Buckets(
	content: string,
	env: "preview" | "production",
): NonNullable<WorkerConfig["r2_buckets"]> | undefined {
	const tag = `[[env.${env}.r2_buckets]]`;
	const buckets: NonNullable<WorkerConfig["r2_buckets"]> = [];
	let cursor = 0;
	while (true) {
		const start = content.indexOf(tag, cursor);
		if (start === -1) break;
		const after = content.slice(start + tag.length);
		const nextHeader = after.search(/\n\[/);
		const block = nextHeader === -1 ? after : after.slice(0, nextHeader);
		const binding = block.match(/binding\s*=\s*"([^"]+)"/)?.[1];
		const bucketName = block.match(/bucket_name\s*=\s*"([^"]+)"/)?.[1];
		if (binding && bucketName) {
			buckets.push({ binding, bucket_name: bucketName });
		}
		cursor = start + tag.length + (nextHeader === -1 ? after.length : nextHeader);
	}
	return buckets.length ? buckets : undefined;
}

// Parse fields needed for environment-specific deployment from wrangler.toml.
//
// Background: @cloudflare/vite-plugin generates dist/<name>/wrangler.json as a
// flat file (no [env.*] sections). Passing --env to `wrangler deploy` has no
// effect on that generated file, so deployments always use the base config
// (database_id "local"). The fix is to bake the correct per-env values into
// the generated wrangler.json at build time via the plugin's config customizer.
function parseWranglerToml(filePath: string) {
	const content = fs.readFileSync(filePath, "utf-8");

	const baseName = content.match(/^name\s*=\s*"([^"]+)"/m)?.[1] ?? "app";

	const previewDb = {
		name:
			content.match(/\[\[env\.preview\.d1_databases\]\][^[]*database_name\s*=\s*"([^"]+)"/s)?.[1] ??
			`${baseName}-preview`,
		id: content.match(/\[\[env\.preview\.d1_databases\]\][^[]*database_id\s*=\s*"([^"]+)"/s)?.[1] ?? "",
	};

	const productionDb = {
		name:
			content.match(/\[\[env\.production\.d1_databases\]\][^[]*database_name\s*=\s*"([^"]+)"/s)?.[1] ??
			baseName,
		id: content.match(/\[\[env\.production\.d1_databases\]\][^[]*database_id\s*=\s*"([^"]+)"/s)?.[1] ?? "",
	};

	const previewEmailSender =
		content.match(/\[\[env\.preview\.send_email\]\][^[]*allowed_sender_addresses\s*=\s*\[\s*"([^"]+)"/s)?.[1] ??
		content.match(/\[\[send_email\]\][^[]*allowed_sender_addresses\s*=\s*\[\s*"([^"]+)"/s)?.[1] ??
		"noreply@example.com";

	const productionEmailSender =
		content.match(/\[\[env\.production\.send_email\]\][^[]*allowed_sender_addresses\s*=\s*\[\s*"([^"]+)"/s)?.[1] ??
		content.match(/\[\[send_email\]\][^[]*allowed_sender_addresses\s*=\s*\[\s*"([^"]+)"/s)?.[1] ??
		"noreply@example.com";

	const previewRoutes = extractEnvRoutes(content, "preview");
	const productionRoutes = extractEnvRoutes(content, "production");

	const previewKvRateId = extractKvRateId(content, "preview");
	const productionKvRateId = extractKvRateId(content, "production");

	const previewVars = extractEnvVars(content, "preview");
	const productionVars = extractEnvVars(content, "production");

	const previewCrons = extractCrons(content, "preview");
	const productionCrons = extractCrons(content, "production");

	const previewR2Buckets = extractR2Buckets(content, "preview");
	const productionR2Buckets = extractR2Buckets(content, "production");

	return {
		baseName,
		previewDb,
		productionDb,
		previewEmailSender,
		productionEmailSender,
		previewRoutes,
		productionRoutes,
		previewKvRateId,
		productionKvRateId,
		previewVars,
		productionVars,
		previewCrons,
		productionCrons,
		previewR2Buckets,
		productionR2Buckets,
	};
}

export default defineConfig(({ mode }) => {
	const {
		baseName,
		previewDb,
		productionDb,
		previewEmailSender,
		productionEmailSender,
		previewRoutes,
		productionRoutes,
		previewKvRateId,
		productionKvRateId,
		previewVars,
		productionVars,
		previewCrons,
		productionCrons,
		previewR2Buckets,
		productionR2Buckets,
	} = parseWranglerToml(path.resolve(__dirname, "wrangler.toml"));

	// Use the mutating function form (returning void) so that array fields like
	// d1_databases are replaced rather than appended, avoiding duplicate entries.
	//
	// IMPORTANT: every per-env field that exists under `[env.<env>.*]` in
	// `wrangler.toml` must be re-injected here. The plugin generates a flat
	// `dist/<name>/wrangler.json` (no `[env.*]` sections), so anything the
	// customizer omits is silently dropped from the deploy. Common gotchas:
	//   - `triggers.crons` → cron schedules disappear (recovery + GC stop firing).
	//   - `[env.*.vars]` extras → env-only Worker vars are missing.
	//   - `[[env.*.r2_buckets]]` → wrong bucket binding ends up on remote envs.
	const configCustomizer =
		mode === "preview"
			? (cfg: WorkerConfig): void => {
					cfg.name = `${baseName}-preview`;
					cfg.vars = previewVars ?? { ENVIRONMENT: "preview", EMAIL_PROVIDER: "cloudflare" };
					cfg.d1_databases = [
						{
							binding: "DB",
							database_name: previewDb.name,
							database_id: previewDb.id,
						},
					];
					cfg.send_email = [
						{
							name: "SEND_EMAIL",
							allowed_sender_addresses: [previewEmailSender],
						},
					];
					if (previewRoutes?.length) {
						cfg.routes = previewRoutes;
					}
					if (previewKvRateId) {
						cfg.kv_namespaces = [{ binding: "KV_RATE", id: previewKvRateId }];
					}
					if (previewR2Buckets?.length) {
						cfg.r2_buckets = previewR2Buckets;
					}
					if (previewCrons?.length) {
						cfg.triggers = { crons: previewCrons };
					}
				}
			: mode === "production"
				? (cfg: WorkerConfig): void => {
						cfg.name = `${baseName}-production`;
						cfg.vars = productionVars ?? { ENVIRONMENT: "production", EMAIL_PROVIDER: "cloudflare" };
						cfg.d1_databases = [
							{
								binding: "DB",
								database_name: productionDb.name,
								database_id: productionDb.id,
							},
						];
						cfg.send_email = [
							{
								name: "SEND_EMAIL",
								allowed_sender_addresses: [productionEmailSender],
							},
						];
						if (productionRoutes?.length) {
							cfg.routes = productionRoutes;
						}
						if (productionKvRateId) {
							cfg.kv_namespaces = [{ binding: "KV_RATE", id: productionKvRateId }];
						}
						if (productionR2Buckets?.length) {
							cfg.r2_buckets = productionR2Buckets;
						}
						if (productionCrons?.length) {
							cfg.triggers = { crons: productionCrons };
						}
					}
				: undefined;

	return {
		plugins: [
			react(),
			cloudflare({
				remoteBindings: false,
				...(configCustomizer ? { config: configCustomizer } : {}),
			}),
		],
		resolve: {
			alias: {
				"@": path.resolve(__dirname, "./src/react-app"),
			},
		},
		// Avoid ELOOP when `.claude/AGENTS.md` is a broken self-symlink (Cursor/Claude hook).
		server: {
			watch: {
				ignored: [path.resolve(__dirname, ".claude")],
			},
		},
	};
});
