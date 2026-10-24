import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { app } from "../src/worker/index";

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
		expect(info.migrations).toEqual(["0001_initial", "0002_add_role", "0003_account_token_columns", "0004_login_events"]);
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
});

describe("sign-in log", () => {
	it("records a failed sign-in with its outcome, and keeps serving the response", async () => {
		const email = `nobody-${Date.now()}@example.com`;
		const res = await call("/api/auth/sign-in/email", {
			method: "POST",
			headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.7" },
			// No password: Better Auth rejects this at validation. Its
			// invalid-credentials path leaks an unhandled rejection from inside
			// the library, which fails the run; see the guard in index.ts.
			body: JSON.stringify({ email }),
		});
		expect(res.status).toBeGreaterThanOrEqual(400);

		const rows = (await (
			await call(`/api/cli/login-events?limit=50`, { headers: { "x-api-key": env.CLI_API_KEY as string } })
		).json()) as { events: Array<{ email: string; success: boolean | number; ip: string | null }> };
		const ours = rows.events.find((e) => e.email === email);
		expect(ours).toBeDefined();
		expect(Boolean(ours?.success)).toBe(false);
		expect(ours?.ip).toBe("203.0.113.7");
	});

	it("resolves the attempt to the account that owns the address", async () => {
		const headers = { "Content-Type": "application/json", "x-api-key": env.CLI_API_KEY as string };
		const email = `known-${Date.now()}@example.com`;
		await call("/api/cli/users", {
			method: "POST",
			headers,
			body: JSON.stringify({ email, password: "correct-horse-battery-staple" }),
		});

		await call("/api/auth/sign-in/email", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email }),
		});

		const rows = (await (
			await call("/api/cli/login-events?limit=50", { headers: { "x-api-key": env.CLI_API_KEY as string } })
		).json()) as { events: Array<{ email: string; user_id: string | null }> };
		// Without this, "how many distinct people signed in" is unanswerable.
		expect(rows.events.find((e) => e.email === email)?.user_id).toBeTruthy();
	});
});
