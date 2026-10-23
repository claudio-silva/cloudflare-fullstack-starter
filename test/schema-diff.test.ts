import { describe, expect, it } from "vitest";
import { diffSnapshots, describeChange, type SchemaSnapshot } from "../src/worker/db/schema-snapshot";

const col = (name: string, nullable = true, hasDefault = false) => ({ name, nullable, hasDefault });

const base: SchemaSnapshot = [{ table: "users", columns: [col("id", false, false), col("email", false, false)] }];

describe("diffSnapshots", () => {
	it("reports no change for an identical snapshot", () => {
		expect(diffSnapshots(base, base)).toEqual([]);
	});

	it("treats a nullable column as additive", () => {
		const after: SchemaSnapshot = [{ table: "users", columns: [...base[0].columns, col("nickname")] }];
		expect(diffSnapshots(base, after)).toEqual([
			{ kind: "column-added", table: "users", column: "nickname", destructive: false },
		]);
	});

	it("treats a NOT NULL column with a default as additive", () => {
		const after: SchemaSnapshot = [
			{ table: "users", columns: [...base[0].columns, col("role", false, true)] },
		];
		expect(diffSnapshots(base, after)[0].destructive).toBe(false);
	});

	// The break this exists to catch: structurally it is an addition, but the
	// version still running beside the migration does not know to write it.
	it("flags a NOT NULL column with no default as destructive", () => {
		const after: SchemaSnapshot = [
			{ table: "users", columns: [...base[0].columns, col("tenant_id", false, false)] },
		];
		expect(diffSnapshots(base, after)).toEqual([
			{ kind: "column-required", table: "users", column: "tenant_id", destructive: true },
		]);
	});

	it("flags a dropped column and a dropped table as destructive", () => {
		const after: SchemaSnapshot = [{ table: "users", columns: [col("id", false, false)] }];
		expect(diffSnapshots(base, after)).toEqual([
			{ kind: "column-removed", table: "users", column: "email", destructive: true },
		]);
		expect(diffSnapshots(base, [])).toEqual([{ kind: "table-removed", table: "users", destructive: true }]);
	});

	it("treats a new table as additive", () => {
		const after: SchemaSnapshot = [...base, { table: "posts", columns: [col("id", false)] }];
		expect(diffSnapshots(base, after)).toEqual([
			{ kind: "table-added", table: "posts", destructive: false },
		]);
	});

	it("describes changes readably", () => {
		expect(describeChange({ kind: "column-removed", table: "users", column: "email", destructive: true })).toBe(
			"- column users.email",
		);
		expect(describeChange({ kind: "table-added", table: "posts", destructive: false })).toBe("+ table posts");
	});
});
