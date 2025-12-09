type Environment = "local" | "preview" | "production";

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

async function authenticateAsAdmin(environment: Environment, email: string, password: string): Promise<string> {
	const baseUrl = getApiBaseUrl(environment);
	const signInUrl = `${baseUrl}/api/auth/sign-in/email`;

	const response = await fetch(signInUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email, password }),
	});

	if (!response.ok) {
		const errorData = (await response.json().catch(() => ({}))) as { message?: string };
		throw new Error(`Admin authentication failed: ${errorData.message || response.statusText}`);
	}

	const setCookieHeader = response.headers.get("set-cookie");
	if (!setCookieHeader) {
		throw new Error("No session cookie received from authentication");
	}

	const sessionMatch = setCookieHeader.match(/better-auth\.session=([^;]+)/);
	if (!sessionMatch) {
		throw new Error("Session token not found in authentication response");
	}

	return sessionMatch[1];
}

async function getAuthHeaders(environment: Environment): Promise<Record<string, string>> {
	if (environment === "local") {
		return {};
	}

	const adminEmail = process.env.CLI_ADMIN_EMAIL;
	const adminPassword = process.env.CLI_ADMIN_PASSWORD;
	if (!adminEmail || !adminPassword) {
		throw new Error(
			`CLI operations in ${environment} environment require admin credentials. Set CLI_ADMIN_EMAIL and CLI_ADMIN_PASSWORD.`,
		);
	}

	const sessionToken = await authenticateAsAdmin(environment, adminEmail, adminPassword);
	return { Cookie: `better-auth.session=${sessionToken}` };
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
