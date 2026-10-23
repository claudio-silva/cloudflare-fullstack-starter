/**
 * Wire-format types shared by the Worker, the management CLI and the deploy
 * scripts. Types only, no runtime and no Cloudflare or Node dependency, so
 * every tsconfig project can import them.
 */

/**
 * How a migration relates to the application version running beside it — the
 * *parallel change* (expand/contract) pattern. It decides the order the deploy
 * uses, because a single fixed order cannot be right for both directions.
 *
 * - `expand`   — additive and backward-compatible. Runs **before** the deploy:
 *                the old code ignores what it does not know about. The default.
 * - `contract` — removes something a previous release stopped using. Runs
 *                **after** the deploy. Requires `safeSince`.
 * - `breaking` — cannot be made compatible; the deploy wraps it in a
 *                maintenance window.
 */
export type MigrationCompatibility = "expand" | "contract" | "breaking";

export type PendingMigration = {
	name: string;
	compatibility: MigrationCompatibility;
	safeSince?: string;
};

export type MigrationStatus = {
	name: string;
	applied: boolean;
	executedAt: string | null;
	compatibility: MigrationCompatibility;
	safeSince: string | null;
};

/** One row of `migration_journal`: what a migration run actually did. */
export type JournalEntry = {
	migration_name: string;
	compatibility: MigrationCompatibility;
	status: "success" | "failed";
	/** Statements the migration sent to the database. */
	statements_attempted: number;
	/** Statements that came back without an error. The failure is the next one. */
	statements_completed: number;
	/** True when the dialect rolled the whole run back, so nothing was applied. */
	rolled_back: boolean;
	error: string | null;
	started_at: string;
	finished_at: string;
};

export type SchemaColumn = { name: string; nullable: boolean; hasDefault: boolean };
export type SchemaTable = { table: string; columns: SchemaColumn[] };
export type SchemaSnapshot = SchemaTable[];

export type SchemaChange = {
	kind: "table-added" | "table-removed" | "column-added" | "column-removed" | "column-required";
	table: string;
	column?: string;
	/** True when the change can break the application version running beside it. */
	destructive: boolean;
};
