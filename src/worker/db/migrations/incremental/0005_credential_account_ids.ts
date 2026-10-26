import { sql, type Kysely } from "kysely";
import type { MigrationFactory } from "../types";

/**
 * Data only: repairs password accounts created by `npm run auth create-user`
 * before 3.3.0.
 *
 * The CLI gave them a random `accountId`, but Better Auth stores the user's own
 * id there for a password account and looks the credential up by it — so those
 * users existed, and could never sign in. The CLI now writes the right value;
 * this fixes the rows it wrote before. Safe to re-run: it only touches rows
 * that are still wrong.
 */
export const credentialAccountIds: MigrationFactory = () => ({
	compatibility: "expand",
	async up(db: Kysely<unknown>) {
		// Through the query builder, not raw SQL: it quotes the camelCase column
		// names, which PostgreSQL would otherwise fold to lower case.
		await (db as Kysely<Record<string, Record<string, unknown>>>)
			.updateTable("accounts")
			.set({ accountId: sql.ref("userId") })
			.where("providerId", "=", "credential")
			.where("accountId", "<>", sql.ref("userId"))
			.execute();
	},
});
