import type { DatabaseKind } from "../index";
import { initial } from "./incremental/0001_initial";
import { addRole } from "./incremental/0002_add_role";
import { accountTokenColumns } from "./incremental/0003_account_token_columns";
import { createBaseline } from "./baseline";
import { loginEvents } from "./incremental/0004_login_events";
import { credentialAccountIds } from "./incremental/0005_credential_account_ids";
import type { MigrationDef } from "./types";

/**
 * Incremental migrations: the upgrade path for existing databases. Names sort in
 * application order. Add yours at the end (`0006_...`) and mirror the change in baseline.ts.
 * Never edit or rename a migration that has been applied anywhere.
 */
export function createMigrations(kind: DatabaseKind): Record<string, MigrationDef> {
	return {
		"0001_initial": initial(kind),
		"0002_add_role": addRole(kind),
		"0003_account_token_columns": accountTokenColumns(kind),
		"0004_login_events": loginEvents(kind),
		"0005_credential_account_ids": credentialAccountIds(kind),
	};
}

export { createBaseline };
export { migrateDatabase, migrationStatus, pendingMigrations } from "./migrate";
