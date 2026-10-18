import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import app from "../src/worker/index";

const call = (path: string, init?: RequestInit) => app.request(path, init, env);

describe("worker API", () => {
	it("serves the health check", async () => {
		const res = await call("/api/");
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ status: "healthy", environment: "test" });
	});

	it("rejects CLI calls without the API key", async () => {
		expect((await call("/api/cli/users")).status).toBe(401);
	});

	it("creates and lists users through the CLI API against D1 (migrations applied)", async () => {
		const headers = { "x-api-key": env.CLI_API_KEY as string, "content-type": "application/json" };

		const created = await call("/api/cli/users", {
			method: "POST",
			headers,
			body: JSON.stringify({ email: "vitest@example.com", password: "password123", name: "Vitest" }),
		});
		expect(created.status).toBeLessThan(300);

		const listed = await call("/api/cli/users?search=vitest", { headers });
		const body = (await listed.json()) as { users: Array<{ email: string; role: string }> };
		expect(body.users).toHaveLength(1);
		expect(body.users[0]).toMatchObject({ email: "vitest@example.com", role: "user" });
	});

	it("keeps counter state in the Durable Object", async () => {
		const first = await call("/api/counter/demo/increment", { method: "POST" });
		expect(await first.json()).toEqual({ count: 1 });
		const second = await call("/api/counter/demo/increment", { method: "POST" });
		expect(await second.json()).toEqual({ count: 2 });
	});
});
