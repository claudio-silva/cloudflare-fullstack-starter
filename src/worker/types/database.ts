/**
 * Database schema types for Kysely matching Better Auth tables.
 */
export interface Database {
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
    token: string;
    expiresAt: number;
    createdAt: number;
    updatedAt: number;
  };
}
