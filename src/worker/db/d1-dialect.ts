/* eslint-disable @typescript-eslint/no-explicit-any */
import { D1Dialect as KyselyD1Dialect } from "kysely-d1";
import { sql, type DatabaseIntrospector, type Kysely, type SchemaMetadata, type TableMetadata } from "kysely";

/**
 * D1 rejects the correlated `pragma_table_info(tl.name)` join that Kysely's stock SQLite
 * introspector uses (SQLITE_AUTH), which also breaks the Migrator. This introspector asks
 * for one table at a time with a literal argument, which D1 allows.
 */
class D1Introspector implements DatabaseIntrospector {
	constructor(private db: Kysely<any>) {}
	async getSchemas(): Promise<SchemaMetadata[]> { return []; }
	async getTables(options = { withInternalKyselyTables: false }): Promise<TableMetadata[]> {
		const tables = await this.db
			.selectFrom("sqlite_master")
			.where("type", "in", ["table", "view"])
			.where("name", "not like", "sqlite_%")
			.where("name", "not like", "_cf_%")
			.select(["name", "type"])
			.orderBy("name")
			.execute();
		const result: TableMetadata[] = [];
		for (const t of tables) {
			if (!options.withInternalKyselyTables && (t.name === "kysely_migration" || t.name === "kysely_migration_lock")) continue;
			const cols = await sql<{ name: string; type: string; notnull: number; dflt_value: string | null }>`
				select name, type, "notnull", dflt_value from pragma_table_info(${sql.lit(t.name)}) order by cid`.execute(this.db);
			result.push({
				name: t.name,
				isView: t.type === "view",
				isForeign: false,
				columns: cols.rows.map((c) => ({
					name: c.name, dataType: c.type, isNullable: !c.notnull, isAutoIncrementing: false, hasDefaultValue: c.dflt_value !== null,
				})),
			});
		}
		return result;
	}
}

/** D1 dialect with an introspector that works on D1 (needed by the Migrator). */
export class D1Dialect extends KyselyD1Dialect {
	createIntrospector(db: Kysely<any>): DatabaseIntrospector { return new D1Introspector(db); }
}
