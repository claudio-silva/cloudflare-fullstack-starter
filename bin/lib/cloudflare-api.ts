/**
 * Minimal Cloudflare API client for the deploy tooling (sync-build-vars,
 * setup-ci). Bearer token only: a user API token, never the Global API Key.
 */

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
