import type { Kysely } from "kysely";
import { columnTypes } from "./columns";
import type { DatabaseKind } from "../index";
import type { Baseline } from "./types";

/**
 * Final-format schema in one step, used for NEW databases so they do not replay history.
 * It must always equal the result of running every incremental migration (a test enforces this).
 * When you add an incremental migration, add the same change here and append its name to `squashes`.
 */
export function createBaseline(kind: DatabaseKind): Baseline {
	const t = columnTypes(kind);
	return {
		squashes: ["0001_initial", "0002_add_role", "0003_account_token_columns"],
		async up(db: Kysely<unknown>) {
			await db.schema
				.createTable("users")
				.addColumn("id", t.id, (c) => c.primaryKey())
				.addColumn("email", t.short, (c) => c.notNull().unique())
				.addColumn("name", t.short)
				.addColumn("image", t.text)
				.addColumn("emailVerified", t.boolean, (c) => c.defaultTo(false))
				.addColumn("createdAt", t.timestamp, (c) => c.notNull())
				.addColumn("updatedAt", t.timestamp, (c) => c.notNull())
				.addColumn("role", t.role, (c) => c.notNull().defaultTo("user"))
				.execute();

			await db.schema
				.createTable("accounts")
				.addColumn("accountId", t.id, (c) => c.primaryKey())
				.addColumn("id", t.id, (c) => c.unique())
				.addColumn("userId", t.id, (c) => c.notNull())
				.addColumn("providerId", t.short, (c) => c.notNull())
				.addColumn("provider", t.short)
				.addColumn("providerAccountId", t.short)
				.addColumn("refreshToken", t.text)
				.addColumn("accessToken", t.text)
				.addColumn("accessTokenExpiresAt", t.timestamp)
				.addColumn("scope", t.text)
				.addColumn("password", t.text)
				.addColumn("createdAt", t.timestamp, (c) => c.notNull())
				.addColumn("updatedAt", t.timestamp, (c) => c.notNull())
				.addColumn("idToken", t.text)
				.addColumn("refreshTokenExpiresAt", t.timestamp)
				// A table constraint, not inline `references`: MySQL silently ignores the inline form.
				.addForeignKeyConstraint("accounts_userId_fk", ["userId"], "users", ["id"], (fk) => fk.onDelete("cascade"))
				.execute();

			await db.schema
				.createTable("sessions")
				.addColumn("id", t.id, (c) => c.primaryKey())
				.addColumn("userId", t.id, (c) => c.notNull())
				.addColumn("token", t.short, (c) => c.notNull().unique())
				.addColumn("expiresAt", t.timestamp, (c) => c.notNull())
				.addColumn("ipAddress", t.short)
				.addColumn("userAgent", t.text)
				.addColumn("createdAt", t.timestamp, (c) => c.notNull())
				.addColumn("updatedAt", t.timestamp, (c) => c.notNull())
				// A table constraint, not inline `references`: MySQL silently ignores the inline form.
				.addForeignKeyConstraint("sessions_userId_fk", ["userId"], "users", ["id"], (fk) => fk.onDelete("cascade"))
				.execute();

			await db.schema
				.createTable("verifications")
				.addColumn("id", t.id, (c) => c.primaryKey())
				.addColumn("identifier", t.short, (c) => c.notNull())
				.addColumn("value", t.text, (c) => c.notNull())
				.addColumn("expiresAt", t.timestamp, (c) => c.notNull())
				.addColumn("createdAt", t.timestamp, (c) => c.notNull())
				.addColumn("updatedAt", t.timestamp, (c) => c.notNull())
				.execute();

			await db.schema.createIndex("idx_sessions_user").on("sessions").column("userId").execute();
			await db.schema.createIndex("idx_verifications_identifier").on("verifications").column("identifier").execute();
			await db.schema.createIndex("idx_users_role").on("users").column("role").execute();
		},
	};
}
