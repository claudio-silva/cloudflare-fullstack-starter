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
    /** Cannot sign in (sessions are refused). Independent of `emailVerified`. */
    disabled: Generated<DbBoolean>;
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
 * The sign-in log and per-user totals. Starter-owned; see
 * `src/worker/db/migrations/incremental/0004_login_events.ts` and `0007_user_stats_and_log_detail.ts`.
 */
export interface AuthLogDatabase {
  login_events: {
    id: string;
    /** Null when the attempt used an address with no account. */
    user_id: string | null;
    email: string;
    success: DbBoolean;
    /** Personal data: see AUTH_LOG_RETENTION_DAYS. */
    ip: string | null;
    user_agent: string | null;
    country: string | null;
    created_at: Timestamp;
    /** Null (every row before 0006) and "sign-in" are sign-ins. The session events say how a session ended without a sign-out; "user-deleted" keeps the user_id and email of an account that no longer exists. */
    event: "sign-in" | "sign-out" | "session-expired" | "session-revoked" | "user-deleted" | null;
    /** How a sign-in authenticated: "password", or the OAuth provider ("google"). */
    method: string | null;
    /** The session a sign-in opened, or a session event ended. */
    session_id: string | null;
    /** Who caused the event when it was not the user: the admin who revoked or deleted. */
    actor_id: string | null;
    /** On the row that ends a session: from sign-in to sign-out, or to the last use when it expired or was revoked. */
    duration_seconds: number | null;
  };
  /** Running totals per user, updated with the log; they outlive pruned log rows and deleted users. */
  user_stats: {
    user_id: string;
    sign_ins: Generated<number>;
    failed_sign_ins: Generated<number>;
    session_seconds: Generated<number>;
    last_sign_in_at: Timestamp | null;
  };
}

/**
 * Full schema seen by Kysely. Add your application tables here (or in an
 * `AppDatabase` interface that this one extends), keeping auth tables as is.
 */
export interface Database extends AuthDatabase, AuthLogDatabase {}
