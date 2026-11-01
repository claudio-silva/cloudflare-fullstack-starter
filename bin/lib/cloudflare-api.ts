/**
 * Minimal Cloudflare API client for the deploy tooling (sync-build-vars,
 * setup-ci, setup-domain, setup-website). Bearer token only: a user API token,
 * never the Global API Key.
 */
import { execFileSync } from "node:child_process";
import { cloudflareCredentials } from "./deploy-config";

export const CF_API = "https://api.cloudflare.com/client/v4";

export class CloudflareApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly codes: number[],
	) {
		super(message);
	}
}

export async function cf<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
	const res = await fetch(`${CF_API}${path}`, {
		method,
		headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
		body: body ? JSON.stringify(body) : undefined,
	});
	const json = (await res.json().catch(() => null)) as {
		success?: boolean;
		result?: T;
		errors?: { code: number; message: string }[];
	} | null;
	// Some DELETEs answer 200 with an empty body.
	if (res.ok && json === null) return undefined as T;
	if (!res.ok || !json?.success) {
		const detail = json?.errors?.map((e) => e.message).join("; ") ?? `HTTP ${res.status}`;
		throw new CloudflareApiError(`${method} ${path}: ${detail}`, res.status, json?.errors?.map((e) => e.code) ?? []);
	}
	return json.result as T;
}

/**
 * The token to work with: the one the deploy scripts use (.env.setup.local or
 * the environment), else whatever `wrangler login` left behind. Empty when
 * there are no credentials at all, which callers decide what to make of — a
 * read-only check skips, a command that changes something stops.
 */
export function apiToken(): string {
	const { token } = cloudflareCredentials();
	if (token) return token;
	try {
		const out = execFileSync("npx", ["wrangler", "auth", "token", "--json"], { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
		return (JSON.parse(out) as { token?: string }).token ?? "";
	} catch {
		return "";
	}
}

/** The account to work in: the configured one, or the only one the token reaches. */
export async function accountId(token: string): Promise<string> {
	const { accountId: configured } = cloudflareCredentials();
	if (configured) return configured;
	const accounts = await cf<{ id: string; name: string }[]>(token, "GET", "/accounts");
	if (accounts.length === 1) return accounts[0].id;
	throw new Error(
		`these credentials reach ${accounts.length} accounts; pick one with CLOUDFLARE_ACCOUNT_ID=<id> (or in .env.setup.local):\n${accounts.map((a) => `  ${a.id}  ${a.name}`).join("\n")}`,
	);
}

/** The Worker serving `hostname` as a Custom Domain, if any. */
export async function workerServing(token: string, account: string, hostname: string): Promise<string | null> {
	const domains = await cf<{ hostname: string; service: string }[]>(token, "GET", `/accounts/${account}/workers/domains?hostname=${encodeURIComponent(hostname)}`);
	return domains.find((d) => d.hostname === hostname)?.service ?? null;
}
