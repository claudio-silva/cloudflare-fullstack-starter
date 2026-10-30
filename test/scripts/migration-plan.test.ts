import { describe, expect, it } from "vitest";
import { planMigrations } from "../../bin/lib/migration-plan";
import type { MigrationStatus } from "../../src/shared/migration-types";

const status = (name: string, applied: boolean, compatibility: MigrationStatus["compatibility"] = "expand"): MigrationStatus => ({
	name,
	applied,
	executedAt: applied ? "2026-10-01T00:00:00Z" : null,
	compatibility,
	safeSince: null,
});

// The running Worker knows 0001-0002; the checkout brings 0003.
const running = [status("0001_initial", true), status("0002_add_role", true)];

describe("planMigrations", () => {
	it("counts what the release brings, which the running Worker cannot report", () => {
		const plan = planMigrations(running, { "0001_initial": {}, "0002_add_role": {}, "0003_new": {} });
		expect(plan.pending).toEqual([{ name: "0003_new", compatibility: "expand", safeSince: null, newInRelease: true }]);
		expect(plan.windowReason).toContain("0003_new comes with this release");
	});

	it("needs no window when nothing is new and nothing is breaking", () => {
		const plan = planMigrations([...running, status("0003_known", false)], { "0001_initial": {}, "0002_add_role": {}, "0003_known": {} });
		expect(plan.byKind("expand").map((m) => m.name)).toEqual(["0003_known"]);
		expect(plan.windowReason).toBeNull();
	});

	it("runs a new contract migration after the deploy, without a window", () => {
		const plan = planMigrations(running, { "0003_drop": { compatibility: "contract", safeSince: "3.6.0" } });
		expect(plan.byKind("contract")).toEqual([{ name: "0003_drop", compatibility: "contract", safeSince: "3.6.0", newInRelease: true }]);
		expect(plan.windowReason).toBeNull();
	});

	it("opens a window for a breaking migration, known or new", () => {
		expect(planMigrations([...running, status("0003_b", false, "breaking")], {}).windowReason).toBe("0003_b is breaking");
		expect(planMigrations(running, { "0003_b": { compatibility: "breaking" } }).windowReason).toBe("0003_b is breaking");
	});

	it("reads the starter's own migrations", async () => {
		const { createMigrations } = await import("../../src/worker/db/migrations");
		const names = Object.keys(createMigrations("sqlite"));
		expect(planMigrations(names.map((n) => status(n, true)), createMigrations("sqlite")).pending).toEqual([]);
	});
});
