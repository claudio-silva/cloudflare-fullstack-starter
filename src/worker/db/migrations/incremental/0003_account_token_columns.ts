import type { Kysely } from "kysely";
import { columnTypes } from "../columns";
import type { MigrationFactory } from "../types";

export const accountTokenColumns: MigrationFactory = (kind) => {
	const t = columnTypes(kind);
	return {
		legacyName: "0003_account_token_columns",
		async up(db: Kysely<unknown>) {
			// Better Auth 1.7 OAuth token columns.
			await db.schema.alterTable("accounts").addColumn("idToken", t.text).execute();
			await db.schema.alterTable("accounts").addColumn("refreshTokenExpiresAt", t.timestamp).execute();
		},
	};
};
