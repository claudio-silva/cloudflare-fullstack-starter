import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

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

type CliUserSummary = {
	id: string;
	email: string;
	name: string | null;
	emailVerified: number | boolean;
	createdAt: number;
	updatedAt: number;
};

type CliAccountDetails = {
	accountId: string;
	providerId: string;
	hasPassword: boolean;
	createdAt: number;
	updatedAt: number;
};

type CliUserDetails = CliUserSummary & {
	image?: string | null;
	account: CliAccountDetails | null;
	activeSessions: number;
};

type CreateUserPayload = { email: string; password: string; name?: string };
type EditUserPayload = { name?: string; email?: string; password?: string };

type BasicResponse = { success?: boolean; message?: string };
type CreateUserResponse = BasicResponse & { userId?: string };
type EditUserResponse = BasicResponse & { user?: { email: string } };
type DeleteAllUsersResponse = BasicResponse & { deletedCount?: number };

type CliDatabaseClient = {
	createUser: (data: CreateUserPayload) => Promise<CreateUserResponse>;
	updatePassword: (email: string, password: string) => Promise<BasicResponse>;
	deleteUser: (email: string) => Promise<BasicResponse>;
	deleteAllUsers: () => Promise<DeleteAllUsersResponse>;
	activateUser: (email: string, activated: boolean) => Promise<BasicResponse>;
	editUser: (email: string, updateData: EditUserPayload) => Promise<EditUserResponse>;
	getUser: (email: string) => Promise<CliUserDetails>;
	listUsers: (params?: { search?: string; limit?: number }) => Promise<CliUserSummary[]>;
};

type SessionCookie = { name: string; value: string };

function loadEnvFile(environment: Environment) {
	const fileName = `.env.${environment}`;
	const filePath = resolve(process.cwd(), fileName);
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

function getSetCookieHeaders(response: Response): string[] {
	const headerExtensions = response.headers as Headers & { getSetCookie?: () => string[] };
	if (typeof headerExtensions.getSetCookie === "function") {
		const cookies = headerExtensions.getSetCookie();
		if (cookies.length > 0) {
			return cookies;
		}
	}

	const single = response.headers.get("set-cookie");
	return single ? [single] : [];
}

function extractSessionCookie(cookieHeaders: string[]): SessionCookie | null {
	const pattern = /\b((?:__Host-|__Secure-)?better[-_]auth\.(?:session(?:_token)?))=([^;]+)/i;
	for (const line of cookieHeaders) {
		const match = line.match(pattern);
		if (match?.[1] && match?.[2]) {
			return { name: match[1], value: match[2] };
		}
	}
	return null;
}

function getApiBaseUrl(environment: Environment): string {
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

async function authenticateAsAdmin(environment: Environment, email: string, password: string): Promise<SessionCookie> {
	const baseUrl = getApiBaseUrl(environment);
	const signInUrl = `${baseUrl}/api/auth/sign-in/email`;
	const responseBodyText = await fetch(signInUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email, password }),
	}).then(async (response) => {
		const text = await response.text();
		let body: unknown = {};
		if (text) {
			try {
				body = JSON.parse(text);
			} catch {
				body = {};
			}
		}
		return { response, body };
	});
	const { response, body } = responseBodyText;

	if (!response.ok) {
		const errorData = (body as { message?: string }) || {};
		const passwordStatus = password ? "set" : "unset";
		const message = errorData.message || response.statusText;
		throw new Error(
			`Admin authentication failed for user '${email}' (password is ${passwordStatus}): ${message}`,
		);
	}

	const setCookieHeaders = getSetCookieHeaders(response);
	const sessionCookie = extractSessionCookie(setCookieHeaders);
	if (sessionCookie) {
		return sessionCookie;
	}

	const parsedBody = body as { token?: string; session?: { token?: string } };
	if (parsedBody.token && typeof parsedBody.token === "string") {
		return { name: "better-auth.session", value: parsedBody.token };
	}
	if (parsedBody.session?.token && typeof parsedBody.session.token === "string") {
		return { name: "better-auth.session", value: parsedBody.session.token };
	}

	if (setCookieHeaders.length > 0) {
		throw new Error("Session token not found in authentication response");
	}
	throw new Error("No session cookie received from authentication");
}

async function getAuthHeaders(environment: Environment): Promise<Record<string, string>> {
	if (environment === "local") {
		return {};
	}

	const adminEmail = process.env.CLI_ADMIN_EMAIL;
	const adminPassword = process.env.CLI_ADMIN_PASSWORD;
	if (!adminEmail || !adminPassword) {
		throw new Error(
			`CLI operations in ${environment} environment require admin credentials for user '${adminEmail || "<unset>"}' (password is ${adminPassword ? "set" : "unset"}). Set CLI_ADMIN_EMAIL and CLI_ADMIN_PASSWORD.`,
		);
	}

	const session = await authenticateAsAdmin(environment, adminEmail, adminPassword);
	return { Cookie: `${session.name}=${session.value}` };
}

async function makeApiRequest<T>(method: string, path: string, body: unknown, environment: Environment): Promise<T> {
	const baseUrl = getApiBaseUrl(environment);
	const url = `${baseUrl}${path}`;
	const headers = {
		"Content-Type": "application/json",
		...(await getAuthHeaders(environment)),
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
		getUser: async (email) => {
			const response = await makeApiRequest<{
				user: CliUserSummary & { image?: string | null };
				account: CliAccountDetails | null;
				activeSessions: number;
			}>(
				"GET",
				`/api/cli/users/${encodeURIComponent(email)}`,
				undefined,
				environment,
			);
			return {
				...response.user,
				account: response.account,
				activeSessions: response.activeSessions,
			};
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
	};
}
