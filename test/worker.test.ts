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

	it("reports the release version and commit", async () => {
		const body = (await (await call("/api/")).json()) as { version?: string; commit?: string };
		expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
		expect(typeof body.commit).toBe("string");
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

	it("backs up and restores through the CLI API (whole database, over HTTP)", async () => {
		const headers = { "x-api-key": env.CLI_API_KEY as string, "content-type": "application/json" };
		const post = (path: string, body: unknown) => call(path, { method: "POST", headers, body: JSON.stringify(body) });
		expect((await call("/api/cli/backup/info")).status).toBe(401);

		await post("/api/cli/users", { email: "backup@example.com", password: "password123", name: "Backup" });
		type Info = { kind: string; migrations: string[]; tables: Array<{ name: string; restoreChunkRows: number }> };
		const info = (await (await call("/api/cli/backup/info", { headers })).json()) as Info;
		expect(info.kind).toBe("sqlite");
		expect(info.migrations).toEqual(["0001_initial", "0002_add_role", "0003_account_token_columns"]);
		const names = info.tables.map((t) => t.name);
		expect(names.indexOf("users")).toBeLessThan(names.indexOf("accounts"));
		expect(names).not.toContain("kysely_migration");
		expect(info.tables.find((t) => t.name === "users")!.restoreChunkRows).toBeGreaterThan(0);

		const dump: Record<string, unknown[]> = {};
		for (const { name } of info.tables) {
			dump[name] = ((await (await call(`/api/cli/backup/rows?table=${name}&offset=0&limit=100`, { headers })).json()) as { rows: unknown[] }).rows;
		}
		expect(dump.users.length).toBeGreaterThan(0);
		expect((await call("/api/cli/backup/rows?table=nope", { headers })).status).toBe(404);

		for (const { name } of [...info.tables].reverse()) await post("/api/cli/restore/clear", { table: name });
		const afterClear = (await (await call("/api/cli/backup/rows?table=users", { headers })).json()) as { rows: unknown[] };
		expect(afterClear.rows).toHaveLength(0);

		for (const { name } of info.tables) {
			if (dump[name].length) expect((await post("/api/cli/restore/rows", { table: name, rows: dump[name] })).status).toBe(200);
			const finished = (await (await post("/api/cli/restore/finish", { table: name })).json()) as { rowCount: number };
			expect(finished.rowCount).toBe(dump[name].length);
		}
		const restored = (await (await call("/api/cli/backup/rows?table=users", { headers })).json()) as { rows: unknown[] };
		expect(restored.rows).toEqual(dump.users);
	});

	it("keeps counter state in the Durable Object", async () => {
		const first = await call("/api/counter/demo/increment", { method: "POST" });
		expect(await first.json()).toEqual({ count: 1 });
		const second = await call("/api/counter/demo/increment", { method: "POST" });
		expect(await second.json()).toEqual({ count: 2 });
	});
});
