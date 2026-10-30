import { readFileSync, existsSync } from "node:fs";
import type { MigrationCompatibility, JournalEntry, SchemaSnapshot } from "../../shared/migration-types";
import type { Role } from "../../shared/roles";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type Environment = "local" | "preview" | "production";

const SUPPORTED_ENVIRONMENTS = new Set<Environment>(["local", "preview", "production"]);

export function normalizeEnvironment(
	optionValue?: string,
	positionalValue?: string,
): Environment {
	const candidate = optionValue || positionalValue || "local";
	if (SUPPORTED_ENVIRONMENTS.has(candidate as Environment)) {
		return candidate as Environment;
	}
	throw new Error(`Invalid environment '${candidate}'. Expected one of: local, preview, production.`);
}

export type CliUserSummary = {
	id: string;
	email: string;
	name: string | null;
	role?: string;
	enabled: boolean;
	emailVerified: boolean;
	/** active, idle, unverified, disabled or offline (src/shared/user-status.ts). */
	status: string;
	idleSeconds: number | null;
	signIns: number;
	failedSignIns: number;
	/** Time in session: ended sessions, plus the open ones up to their last use. */
	usageSeconds: number;
	lastSignInAt: string | null;
	createdAt: string | null;
	updatedAt: string | null;
};

type CliAccountDetails = {
	accountId: string;
	providerId: string;
	hasPassword: boolean;
	createdAt: string | null;
	updatedAt: string | null;
};

export type CliUserDetails = CliUserSummary & {
	image?: string | null;
	/** "credential" (email and password), "google", … */
	signInMethods: string[];
	account: CliAccountDetails | null;
	activeSessions: number;
	/** The session used last: its IP, and the country of the latest sign-in. */
	currentSession: { ip: string | null; country: string | null; lastSeenAt: string | null } | null;
	lastSignOutAt: string | null;
	activityCount: number;
};

export type CliActivityEvent = {
	kind: "sign-in" | "failed" | "sign-out" | "session-expired" | "session-revoked";
	method: string | null;
	durationSeconds: number | null;
	/** Who caused it, when not the user (an admin revoking their sessions). */
	actor: string | null;
	ip: string | null;
	country: string | null;
	userAgent: string | null;
	createdAt: string | null;
};

type CreateUserPayload = { email: string; password: string; name?: string; role?: Role; enabled?: boolean };
type EditUserPayload = { name?: string; email?: string; password?: string; role?: Role };

type BasicResponse = { success?: boolean; message?: string };
type CreateUserResponse = BasicResponse & { userId?: string };
type EditUserResponse = BasicResponse & { user?: { email: string } };
type DeleteAllUsersResponse = BasicResponse & { deletedCount?: number };

export type CliDatabaseClient = {
	createUser: (data: CreateUserPayload) => Promise<CreateUserResponse>;
	updatePassword: (email: string, password: string) => Promise<BasicResponse>;
	deleteUser: (email: string) => Promise<BasicResponse>;
	deleteAllUsers: () => Promise<DeleteAllUsersResponse>;
	activateUser: (email: string, activated: boolean) => Promise<BasicResponse>;
	setEnabled: (email: string, enabled: boolean) => Promise<BasicResponse>;
	signOutUser: (email: string) => Promise<BasicResponse & { sessions?: number }>;
	userActivity: (email: string, limit?: number) => Promise<CliActivityEvent[]>;
	editUser: (email: string, updateData: EditUserPayload) => Promise<EditUserResponse>;
	getUser: (email: string) => Promise<CliUserDetails>;
	listUsers: (params?: { search?: string; limit?: number }) => Promise<CliUserSummary[]>;
	setRole: (email: string, role: Role) => Promise<BasicResponse>;
	migrate: (only?: MigrationCompatibility[]) => Promise<MigrateResponse>;
	migrations: () => Promise<MigrationStatus[]>;
	pendingMigrations: () => Promise<PendingMigration[]>;
	migrationJournal: (limit?: number) => Promise<JournalEntry[]>;
	schema: () => Promise<SchemaSnapshot>;
	loginEvents: (limit?: number) => Promise<LoginEventsResponse>;
	listSeeds: () => Promise<string[]>;
	runSeed: (name: string) => Promise<BasicResponse>;
	backupInfo: () => Promise<BackupInfo>;
	backupRows: (table: string, offset: number, limit: number) => Promise<unknown[]>;
	restoreClear: (table: string) => Promise<void>;
	restoreRows: (table: string, rows: unknown[]) => Promise<void>;
	restoreFinish: (table: string) => Promise<{ rowCount: number }>;
};

export type BackupInfo = {
	kind: "sqlite" | "postgres" | "mysql";
	/** Names of the applied migrations. */
	migrations: string[];
	/** Data tables, parents before the tables that reference them. */
	tables: Array<{ name: string; columns: string[]; primaryKey: string[]; restoreChunkRows: number }>;
};

type MigrateResponse = { mode: "baseline" | "adopted-legacy" | "incremental"; applied: string[] };
export type MigrationStatus = {
	name: string;
	applied: boolean;
	executedAt: string | null;
	compatibility: MigrationCompatibility;
	safeSince: string | null;
};
export type PendingMigration = { name: string; compatibility: MigrationCompatibility; safeSince?: string };
export type LoginEvent = {
	email: string;
	success: boolean;
	ip: string | null;
	country: string | null;
	user_agent: string | null;
	created_at: string | null;
};
export type LoginEventsResponse = { events: LoginEvent[]; totals: { attempts: number; distinctUsers: number } };

function loadEnvFile(environment: Environment) {
	const fileName = `.env.${environment}`;
	const filePath = resolve(fileURLToPath(new URL("../../../", import.meta.url).href), fileName); // the app directory, not the working directory
	if (!existsSync(filePath)) {
		return;
	}

	const envFile = readFileSync(filePath, "utf-8");
	for (const rawLine of envFile.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;

		const equalsIndex = line.indexOf("=");
		if (equalsIndex === -1) continue;

		const key = line.slice(0, equalsIndex).trim();
		let value = line.slice(equalsIndex + 1).trim();
		if (!key) continue;

		if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
			value = value.slice(1, -1).replace(/\\"/g, '"');
		} else if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
			value = value.slice(1, -1).replace(/\\'/g, "'");
		} else {
			const commentStart = value.indexOf(" #");
			if (commentStart !== -1) {
				value = value.slice(0, commentStart).trim();
			}
		}

		if (process.env[key] === undefined) {
			process.env[key] = value;
		}
	}
}

/**
 * Base URL of the deployed Worker for an environment.
 *
 * Loads `.env.<environment>` itself rather than trusting a caller to have done
 * it: `connectToDatabase` used to be the only thing that did, so any other
 * caller silently fell through to the placeholder URL in `src/config.ts` and
 * polled a host that was never going to answer.
 */
export function getApiBaseUrl(environment: Environment): string {
	loadEnvFile(environment);
	switch (environment) {
		case "local":
			return process.env.CLI_API_URL || "http://localhost:5173";
		case "preview":
			return process.env.CLI_API_URL_PREVIEW || "https://preview.example.com";
		case "production":
			return process.env.CLI_API_URL_PRODUCTION || "https://app.example.com";
		default:
			throw new Error(`Unknown environment: ${environment}`);
	}
}

function getAuthHeaders(environment: Environment): Record<string, string> {
	const apiKey = process.env.CLI_API_KEY;
	if (!apiKey) {
		throw new Error(
			`CLI operations in ${environment} require CLI_API_KEY to be set in .env.${environment}.`,
		);
	}
	return { "x-api-key": apiKey };
}

async function makeApiRequest<T>(method: string, path: string, body: unknown, environment: Environment): Promise<T> {
	const baseUrl = getApiBaseUrl(environment);
	const url = `${baseUrl}${path}`;
	const headers = {
		"Content-Type": "application/json",
		...getAuthHeaders(environment),
	};

	const res = await fetch(url, {
		method,
		headers,
		body: body ? JSON.stringify(body) : undefined,
	});
	const data = (await res.json().catch(() => ({}))) as { error?: string };
	if (!res.ok) {
		throw new Error(data.error || `HTTP ${res.status}: ${res.statusText}`);
	}
	return data as T;
}

export async function connectToDatabase(environment: Environment): Promise<CliDatabaseClient> {
	loadEnvFile(environment);
	return {
		createUser: (data) => makeApiRequest<CreateUserResponse>("POST", "/api/cli/users", data, environment),
		updatePassword: (email, password) =>
			makeApiRequest<BasicResponse>("PUT", `/api/cli/users/${encodeURIComponent(email)}/password`, { password }, environment),
		deleteUser: (email) => makeApiRequest<BasicResponse>("DELETE", `/api/cli/users/${encodeURIComponent(email)}`, undefined, environment),
		deleteAllUsers: () => makeApiRequest<DeleteAllUsersResponse>("DELETE", "/api/cli/users", undefined, environment),
		activateUser: (email, activated) =>
			makeApiRequest<BasicResponse>("PUT", `/api/cli/users/${encodeURIComponent(email)}/activate`, { activated }, environment),
		editUser: (email, updateData) =>
			makeApiRequest<EditUserResponse>("PUT", `/api/cli/users/${encodeURIComponent(email)}`, updateData, environment),
		setEnabled: (email, enabled) =>
			makeApiRequest<BasicResponse>("PUT", `/api/cli/users/${encodeURIComponent(email)}/enabled`, { enabled }, environment),
		signOutUser: (email) =>
			makeApiRequest<BasicResponse & { sessions?: number }>("POST", `/api/cli/users/${encodeURIComponent(email)}/sign-out`, undefined, environment),
		userActivity: async (email, limit = 20) =>
			(
				await makeApiRequest<{ events: CliActivityEvent[] }>(
					"GET",
					`/api/cli/users/${encodeURIComponent(email)}/activity?limit=${limit}`,
					undefined,
					environment,
				)
			).events,
		getUser: async (email) => {
			const { user, ...rest } = await makeApiRequest<{ user: CliUserSummary & { image?: string | null } } & Omit<CliUserDetails, keyof CliUserSummary | "image">>(
				"GET",
				`/api/cli/users/${encodeURIComponent(email)}`,
				undefined,
				environment,
			);
			return { ...user, ...rest };
		},
		listUsers: async (params) => {
			const searchParams = new URLSearchParams();
			if (params?.search) searchParams.append("search", params.search);
			if (params?.limit) searchParams.append("limit", params.limit.toString());
			const response = await makeApiRequest<{ users: CliUserSummary[] }>(
				"GET",
				`/api/cli/users?${searchParams}`,
				undefined,
				environment,
			);
			return response.users;
		},
		migrate: (only) => makeApiRequest<MigrateResponse>("POST", "/api/cli/migrate", only ? { only } : {}, environment),
		migrations: async () =>
			(await makeApiRequest<{ migrations: MigrationStatus[] }>("GET", "/api/cli/migrations", undefined, environment)).migrations,
		pendingMigrations: async () =>
			(await makeApiRequest<{ pending: PendingMigration[] }>("GET", "/api/cli/migrations/pending", undefined, environment)).pending,
		migrationJournal: async (limit = 20) =>
			(await makeApiRequest<{ entries: JournalEntry[] }>("GET", `/api/cli/migrations/journal?limit=${limit}`, undefined, environment)).entries,
		schema: async () =>
			(await makeApiRequest<{ schema: SchemaSnapshot }>("GET", "/api/cli/schema", undefined, environment)).schema,
		loginEvents: (limit = 50) =>
			makeApiRequest<LoginEventsResponse>("GET", `/api/cli/login-events?limit=${limit}`, undefined, environment),
		listSeeds: async () => (await makeApiRequest<{ seeds: string[] }>("GET", "/api/cli/seeds", undefined, environment)).seeds,
		runSeed: (name) => makeApiRequest<BasicResponse>("POST", "/api/cli/seed", { name }, environment),
		backupInfo: () => makeApiRequest<BackupInfo>("GET", "/api/cli/backup/info", undefined, environment),
		backupRows: async (table, offset, limit) =>
			(
				await makeApiRequest<{ rows: unknown[] }>(
					"GET",
					`/api/cli/backup/rows?table=${encodeURIComponent(table)}&offset=${offset}&limit=${limit}`,
					undefined,
					environment,
				)
			).rows,
		restoreClear: async (table) => {
			await makeApiRequest("POST", "/api/cli/restore/clear", { table }, environment);
		},
		restoreRows: async (table, rows) => {
			await makeApiRequest("POST", "/api/cli/restore/rows", { table, rows }, environment);
		},
		restoreFinish: (table) => makeApiRequest<{ rowCount: number }>("POST", "/api/cli/restore/finish", { table }, environment),
		setRole: (email, role) =>
			makeApiRequest<BasicResponse>(
				"PUT",
				`/api/cli/users/${encodeURIComponent(email)}/role`,
				{ role },
				environment,
			),
	};
}
