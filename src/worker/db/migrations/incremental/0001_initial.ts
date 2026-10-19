import type { Kysely } from "kysely";
import { columnTypes } from "../columns";
import type { MigrationFactory } from "../types";

export const initial: MigrationFactory = (kind) => {
	const t = columnTypes(kind);
	return {
		legacyName: "0001_initial_schema",
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
				.execute();

			await db.schema
				.createTable("accounts")
				.addColumn("accountId", t.id, (c) => c.primaryKey())
				.addColumn("id", t.id, (c) => c.unique())
				.addColumn("userId", t.id, (c) => c.notNull().references("users.id").onDelete("cascade"))
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
				.execute();

			await db.schema
				.createTable("sessions")
				.addColumn("id", t.id, (c) => c.primaryKey())
				.addColumn("userId", t.id, (c) => c.notNull().references("users.id").onDelete("cascade"))
				.addColumn("token", t.short, (c) => c.notNull().unique())
				.addColumn("expiresAt", t.timestamp, (c) => c.notNull())
				.addColumn("ipAddress", t.short)
				.addColumn("userAgent", t.text)
				.addColumn("createdAt", t.timestamp, (c) => c.notNull())
				.addColumn("updatedAt", t.timestamp, (c) => c.notNull())
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
		},
	};
};
