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
		squashes: [
			"0001_initial",
			"0002_add_role",
			"0003_account_token_columns",
			"0004_login_events",
			// Data only: a new database has no rows to repair.
			"0005_credential_account_ids",
			"0006_login_event_kind",
		],
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

			// Sign-in attempts, successful and failed. See 0004_login_events.
			await db.schema
				.createTable("login_events")
				.addColumn("id", t.id, (c) => c.primaryKey())
				.addColumn("user_id", t.id)
				.addColumn("email", t.short, (c) => c.notNull())
				.addColumn("success", t.boolean, (c) => c.notNull())
				.addColumn("ip", t.short)
				.addColumn("user_agent", t.text)
				.addColumn("country", "varchar(2)")
				.addColumn("created_at", t.timestamp, (c) => c.notNull())
				// Null is a sign-in; "sign-out" is the other. See 0006_login_event_kind.
				.addColumn("event", "varchar(16)")
				.execute();

			await db.schema.createIndex("idx_sessions_user").on("sessions").column("userId").execute();
			await db.schema.createIndex("idx_login_events_created_at").on("login_events").column("created_at").execute();
			await db.schema.createIndex("idx_login_events_email").on("login_events").column("email").execute();
			await db.schema.createIndex("idx_verifications_identifier").on("verifications").column("identifier").execute();
			await db.schema.createIndex("idx_users_role").on("users").column("role").execute();
		},
	};
}
