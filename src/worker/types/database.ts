import type { Generated } from "kysely";

/**
 * An instant as returned by the driver: ISO string on SQLite/D1, `Date` on PostgreSQL/MySQL.
 * Write instants with `dbNow()` and serialise them with `toIso()` (both in src/worker/db).
 */
export type Timestamp = Date | string;

/** Boolean as returned by the driver: 0/1 on SQLite and MySQL, boolean on PostgreSQL. */
export type DbBoolean = boolean | number;

/**
 * Tables owned by Better Auth (and the auth CLI). Treat as starter-owned.
 */
export interface AuthDatabase {
  users: {
    id: string;
    email: string;
    name: string | null;
    image: string | null;
    emailVerified: Generated<DbBoolean>;
    createdAt: Timestamp;
    updatedAt: Timestamp;
    /** Built-in roles: 'user' | 'admin'. Developers may add more. Default: 'user'. */
    role: Generated<string>;
  };
  accounts: {
    accountId: string;
    id: string | null;
    userId: string;
    providerId: string;
    provider: string | null;
    providerAccountId: string | null;
    refreshToken: string | null;
    accessToken: string | null;
    accessTokenExpiresAt: Timestamp | null;
    idToken: string | null;
    refreshTokenExpiresAt: Timestamp | null;
    scope: string | null;
    password: string | null;
    createdAt: Timestamp;
    updatedAt: Timestamp;
  };
  sessions: {
    id: string;
    userId: string;
    token: string;
    expiresAt: Timestamp;
    ipAddress: string | null;
    userAgent: string | null;
    createdAt: Timestamp;
    updatedAt: Timestamp;
  };
  verifications: {
    id: string;
    identifier: string;
    value: string;
    expiresAt: Timestamp;
    createdAt: Timestamp;
    updatedAt: Timestamp;
  };
}

/**
 * Sign-in attempts. Starter-owned; see `src/worker/db/migrations/incremental/0004_login_events.ts`.
 */
export interface AuthLogDatabase {
  login_events: {
    id: string;
    /** Null when the attempt used an address with no account. */
    user_id: string | null;
    email: string;
    success: DbBoolean;
    /** Personal data: pruned by the scheduled handler. */
    ip: string | null;
    user_agent: string | null;
    country: string | null;
    created_at: Timestamp;
  };
}

/**
 * Full schema seen by Kysely. Add your application tables here (or in an
 * `AppDatabase` interface that this one extends), keeping auth tables as is.
 */
export interface Database extends AuthDatabase, AuthLogDatabase {}
