/**
 * Tables owned by Better Auth (and the auth CLI). Treat as starter-owned.
 */
export interface AuthDatabase {
  users: {
    id: string;
    email: string;
    name: string | null;
    image: string | null;
    emailVerified: number;
    createdAt: number;
    updatedAt: number;
    /** Built-in roles: 'user' | 'admin'. Developers may add more. Default: 'user'. */
    role: string;
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
    accessTokenExpiresAt: number | null;
    idToken: string | null;
    refreshTokenExpiresAt: number | null;
    scope: string | null;
    password: string | null;
    createdAt: number;
    updatedAt: number;
  };
  sessions: {
    id: string;
    userId: string;
    token: string;
    expiresAt: number;
    ipAddress: string | null;
    userAgent: string | null;
    createdAt: number;
    updatedAt: number;
  };
  verifications: {
    id: string;
    identifier: string;
    value: string;
    expiresAt: number;
    createdAt: number;
    updatedAt: number;
  };
}

/**
 * Full schema seen by Kysely. Add your application tables here (or in an
 * `AppDatabase` interface that this one extends), keeping auth tables as is.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Database extends AuthDatabase {}
