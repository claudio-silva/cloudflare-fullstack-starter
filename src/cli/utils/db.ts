type Environment = "local" | "preview" | "production";

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
		const errorData = await response.json().catch(() => ({}));
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

async function makeApiRequest(method: string, path: string, body: any, environment: Environment) {
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
	const data = await res.json();
	if (!res.ok) {
		throw new Error(data.error || `HTTP ${res.status}: ${res.statusText}`);
	}
	return data;
}

export async function connectToDatabase(environment: Environment) {
	return {
		createUser: (data: { email: string; password: string; name?: string }) =>
			makeApiRequest("POST", "/api/cli/users", data, environment),
		updatePassword: (email: string, password: string) =>
			makeApiRequest("PUT", `/api/cli/users/${encodeURIComponent(email)}/password`, { password }, environment),
		deleteUser: (email: string) => makeApiRequest("DELETE", `/api/cli/users/${encodeURIComponent(email)}`, undefined, environment),
		deleteAllUsers: () => makeApiRequest("DELETE", "/api/cli/users", undefined, environment),
		activateUser: (email: string, activated: boolean) =>
			makeApiRequest("PUT", `/api/cli/users/${encodeURIComponent(email)}/activate`, { activated }, environment),
		editUser: (email: string, updateData: { name?: string; email?: string; password?: string }) =>
			makeApiRequest("PUT", `/api/cli/users/${encodeURIComponent(email)}`, updateData, environment),
		getUser: async (email: string) => {
			const response = await makeApiRequest("GET", `/api/cli/users/${encodeURIComponent(email)}`, undefined, environment);
			return response.user;
		},
		listUsers: async (params?: { search?: string; limit?: number }) => {
			const searchParams = new URLSearchParams();
			if (params?.search) searchParams.append("search", params.search);
			if (params?.limit) searchParams.append("limit", params.limit.toString());
			const response = await makeApiRequest("GET", `/api/cli/users?${searchParams}`, undefined, environment);
			return response.users;
		},
	};
}
