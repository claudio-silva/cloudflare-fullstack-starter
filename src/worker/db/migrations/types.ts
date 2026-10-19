import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";
import type { DatabaseKind } from "../index";

export type MigrationDef = Migration & {
	/** Name of the equivalent legacy `wrangler d1 migrations` file (without `.sql`), used to adopt old D1 databases. */
	legacyName?: string;
};

export type MigrationFactory = (kind: DatabaseKind) => MigrationDef;

export type Baseline = {
	up: (db: Kysely<unknown>) => Promise<void>;
	/** Incremental migrations already contained in the baseline. */
	squashes: string[];
};
