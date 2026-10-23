import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";
import type { DatabaseKind } from "../index";

import type { MigrationCompatibility } from "../../../shared/migration-types";

export type { MigrationCompatibility };

export type MigrationDef = Migration & {
	/** Name of the equivalent legacy `wrangler d1 migrations` file (without `.sql`), used to adopt old D1 databases. */
	legacyName?: string;
	/** Defaults to `expand`. See {@link MigrationCompatibility}. */
	compatibility?: MigrationCompatibility;
	/**
	 * For `contract` only: the release that stopped using what this migration
	 * removes. The deploy reads the version actually live (`GET /api/`) and
	 * refuses to run the migration while production is older than this, which
	 * turns "remember to wait a release" from discipline into a check.
	 */
	safeSince?: string;
};

export type MigrationFactory = (kind: DatabaseKind) => MigrationDef;

export type Baseline = {
	up: (db: Kysely<unknown>) => Promise<void>;
	/** Incremental migrations already contained in the baseline. */
	squashes: string[];
};
