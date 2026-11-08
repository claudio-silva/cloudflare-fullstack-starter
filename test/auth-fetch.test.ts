import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuthClient } from "better-auth/client";
import { createAuthFetch, createSessionEnded } from "../src/react-app/lib/auth/session-ended";

/**
 * Better Auth captures `fetch` when its client is created, which is before the
 * HTTP layer is installed. The client is built with `createAuthFetch`, which
 * looks `fetch` up per request, so a layer installed later still sees its
 * requests (src/react-app/lib/auth/client.ts).
 */

afterEach(() => vi.unstubAllGlobals());

describe("Better Auth's requests", () => {
	it("go through whatever fetch is installed after the client was created", async () => {
		const state = createSessionEnded({ storage: null, replaceLocation: () => undefined });
		const client = createAuthClient({ baseURL: "http://localhost", fetchOptions: { customFetchImpl: createAuthFetch(state) } });

		const seen: string[] = [];
		// Installed after the client, as main.tsx does with the HTTP layer.
		vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
			seen.push(input instanceof Request ? input.url : String(input));
			return new Response("null", { status: 200, headers: { "content-type": "application/json" } });
		});

		await client.getSession();
		expect(seen.some((url) => url.endsWith("/api/auth/get-session"))).toBe(true);
	});
});
