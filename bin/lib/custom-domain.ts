/**
 * A custom domain for an environment's Worker: attached on Cloudflare,
 * recorded in wrangler.toml, and made the app's URL in `.env.<env>`. Used by
 * `npm run setup:domain` and by `setup:ci --domain`.
 *
 * The domain is attached through the API rather than by the next deploy, so it
 * answers before anything points at it: the app's URL changes only once the
 * new hostname serves the Worker, and a production domain needs no release.
 * wrangler.toml records it too (`routes`, `custom_domain = true`), so every
 * later deploy keeps it, and the maintenance window finds the hostname there.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parse as parseToml } from "smol-toml";
import { cf, CloudflareApiError } from "./cloudflare-api";
import { fillEnv } from "./setup-ci";

// --- Pure helpers ---------------------------------------------------------------

/** `app.example.com` from what a person types (a URL, a trailing dot, capitals); null when it is not a hostname. */
export function normalizeHostname(input: string): string | null {
	const host = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/?#].*$/, "").replace(/\.$/, "");
	const label = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
	if (host.length > 253 || !new RegExp(`^(?:${label}\\.)+[a-z][a-z0-9-]{0,62}$`).test(host)) return null;
	if (host.endsWith(".workers.dev")) return null;
	return host;
}

/** The zones a hostname could belong to, most specific first: `a.b.example.com`, `b.example.com`, `example.com`. */
export function zoneCandidates(hostname: string): string[] {
	const labels = hostname.split(".");
	return labels.slice(0, -1).map((_, i) => labels.slice(i).join("."));
}

type Route = string | { pattern: string; custom_domain?: boolean; [key: string]: unknown };

function routesOf(source: string, env: string): Route[] {
	const toml = parseToml(source) as { env?: Record<string, { routes?: Route[] }> };
	return toml.env?.[env]?.routes ?? [];
}

/** Hostnames attached as custom domains under `[env.<env>]`. */
export function customDomains(source: string, env: string): string[] {
	return routesOf(source, env).flatMap((r) => (typeof r === "object" && r.custom_domain ? [r.pattern] : []));
}

const tomlValue = (v: unknown): string => (typeof v === "string" ? JSON.stringify(v) : String(v));
const tomlRoute = (r: Route): string =>
	typeof r === "string" ? tomlValue(r) : `{ ${Object.entries(r).map(([k, v]) => `${k} = ${tomlValue(v)}`).join(", ")} }`;

/**
 * wrangler.toml with `hostname` as a custom domain of `[env.<env>]`, its
 * comments and layout kept; null when it is there already. Other routes are
 * kept. Throws on a layout it cannot edit safely (a `routes` array spread over
 * several lines).
 */
export function withCustomDomainRoute(source: string, env: string, hostname: string): string | null {
	if (customDomains(source, env).includes(hostname)) return null;
	const route = { pattern: hostname, custom_domain: true };
	const lines = source.split("\n");
	const header = lines.findIndex((l) => l.trim() === `[env.${env}]`);
	let result: string;

	if (lines.some((l) => l.trim() === `[[env.${env}.routes]]`)) {
		result = `${source.replace(/\n*$/, "")}\n\n[[env.${env}.routes]]\npattern = ${tomlValue(hostname)}\ncustom_domain = true\n`;
	} else if (header === -1) {
		// Only sub-tables (`[env.x.vars]`, ...) so far: the table itself goes before the first.
		const first = lines.findIndex((l) => l.trim().startsWith(`[env.${env}.`) || l.trim().startsWith(`[[env.${env}.`));
		const block = [`[env.${env}]`, `routes = [${tomlRoute(route)}]`, ""];
		if (first === -1) lines.push("", ...block);
		else lines.splice(first, 0, ...block);
		result = lines.join("\n");
	} else {
		let end = lines.findIndex((l, i) => i > header && l.trim().startsWith("["));
		if (end === -1) end = lines.length;
		const at = lines.findIndex((l, i) => i > header && i < end && /^\s*routes\s*=/.test(l));
		if (at === -1) {
			lines.splice(header + 1, 0, `routes = [${tomlRoute(route)}]`);
		} else {
			let existing: Route[];
			try {
				existing = (parseToml(lines[at]) as { routes: Route[] }).routes;
			} catch (error) {
				throw new Error(`the routes of [env.${env}] in wrangler.toml span several lines; add { pattern = "${hostname}", custom_domain = true } by hand`, { cause: error });
			}
			lines[at] = `routes = [${[...existing, route].map(tomlRoute).join(", ")}]`;
		}
		result = lines.join("\n");
	}

	if (!customDomains(result, env).includes(hostname)) throw new Error(`could not add ${hostname} to [env.${env}] in wrangler.toml`);
	return result;
}

// --- Cloudflare -----------------------------------------------------------------

export type DomainReporter = {
	ok(message: string): void;
	note(message: string): void;
	change(message: string): void;
};

export type AttachOptions = {
	token: string;
	accountId: string;
	env: "preview" | "production";
	hostname: string;
	workerName: string;
	dryRun: boolean;
	report: DomainReporter;
};

type Zone = { id: string; name: string; status: string };
type WorkerDomain = { hostname: string; service: string; zone_id: string };

/** The account's zone that holds `hostname`. */
async function findZone(token: string, accountId: string, hostname: string): Promise<Zone> {
	for (const name of zoneCandidates(hostname)) {
		const zones = await cf<Zone[]>(token, "GET", `/zones?name=${encodeURIComponent(name)}&account.id=${accountId}`);
		const zone = zones.find((z) => z.name === name);
		if (!zone) continue;
		if (zone.status !== "active") {
			throw new Error(`the zone ${zone.name} is ${zone.status} on Cloudflare: its nameservers must point to Cloudflare before it can serve a Worker (dashboard → ${zone.name} → Overview).`);
		}
		return zone;
	}
	const root = zoneCandidates(hostname).at(-1);
	throw new Error(
		`no zone for ${hostname} on this Cloudflare account. Add ${root} (dashboard → Add a domain) and point its nameservers to Cloudflare, then run this again.`,
	);
}

/** Wait until https://<hostname>/api/ answers, which needs its DNS record and certificate. */
async function waitUntilServing(hostname: string, report: DomainReporter, timeoutMs = 600_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	let last = "";
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`https://${hostname}/api/`, { signal: AbortSignal.timeout(10_000) });
			const body = (await res.json().catch(() => ({}))) as { status?: string };
			if (res.ok && body.status) return report.ok(`https://${hostname} serves the Worker`);
			last = `HTTP ${res.status}`;
		} catch (error) {
			last = (error as { cause?: { code?: string } }).cause?.code ?? (error instanceof Error ? error.message : String(error));
		}
		await new Promise((done) => setTimeout(done, 10_000));
	}
	throw new Error(`https://${hostname} still does not answer (${last}). The certificate can take a few more minutes; run this again later: it carries on from here.`);
}

/** Run a sync script of bin/ on `env`, its output shown. */
function sync(script: string, env: string, accountId: string): void {
	const result = spawnSync("npx", ["tsx", script, env], { stdio: "inherit", env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId } });
	if (result.status !== 0) throw new Error(`${script} ${env} failed (above).`);
}

/**
 * Attach `hostname` to the environment's Worker and make it the app's URL.
 * Safe to run again: each step checks first. Returns the zone, which the
 * maintenance window needs.
 */
export async function attachCustomDomain(o: AttachOptions): Promise<Zone> {
	const { token, accountId, env, hostname, workerName, dryRun, report } = o;
	const zone = await findZone(token, accountId, hostname);
	report.ok(`zone ${zone.name} (${zone.id})`);

	const attached = await cf<WorkerDomain[]>(token, "GET", `/accounts/${accountId}/workers/domains?hostname=${encodeURIComponent(hostname)}`);
	const current = attached.find((d) => d.hostname === hostname);
	if (current && current.service !== workerName) {
		throw new Error(`${hostname} already serves the Worker ${current.service}. Detach it there first (dashboard → ${current.service} → Settings → Domains & Routes).`);
	}
	if (current) {
		report.ok(`${hostname} is attached to ${workerName}`);
	} else {
		report.change(`attach ${hostname} to the Worker ${workerName} (Cloudflare creates its DNS record and certificate)`);
		if (!dryRun) {
			try {
				await cf(token, "PUT", `/accounts/${accountId}/workers/domains`, { hostname, service: workerName, zone_id: zone.id });
			} catch (error) {
				if (!(error instanceof CloudflareApiError)) throw error;
				if (error.status === 403 || error.status === 401) {
					throw new Error(`the token may not attach domains (${error.message}). It needs "Workers Scripts: Edit" on the account and "Workers Routes: Edit" on ${zone.name}.`, { cause: error });
				}
				if (/dns|record|exist/i.test(error.message)) {
					throw new Error(`${hostname} has DNS records already (${error.message}). Delete them (dashboard → ${zone.name} → DNS → Records) or choose another hostname.`, { cause: error });
				}
				throw error;
			}
		}
	}
	if (!dryRun) await waitUntilServing(hostname, report);

	const toml = readFileSync("wrangler.toml", "utf-8");
	const updated = withCustomDomainRoute(toml, env, hostname);
	if (updated) {
		report.change(`record ${hostname} in wrangler.toml ([env.${env}] routes), so every deploy keeps it`);
		if (!dryRun) writeFileSync("wrangler.toml", updated);
	} else {
		report.ok(`wrangler.toml lists ${hostname}`);
	}

	// The URL changes last, once the domain answers: sign-in accepts only this origin.
	const file = `.env.${env}`;
	const url = `https://${hostname}`;
	const values = { APP_BASE_URL: url, [`CLI_API_URL_${env.toUpperCase()}`]: url };
	const content = existsSync(file) ? readFileSync(file, "utf-8") : "";
	const filled = fillEnv(content, values, { overwrite: true });
	if (filled.changed.length) {
		report.change(`set ${filled.changed.join(", ")}=${url} in ${file}, and sync it to Cloudflare`);
		if (!dryRun) {
			writeFileSync(file, filled.content);
			sync("bin/sync-secrets.ts", env, accountId);
			sync("bin/sync-build-vars.ts", env, accountId);
		}
	} else {
		report.ok(`${file} uses ${url}`);
	}
	return zone;
}
