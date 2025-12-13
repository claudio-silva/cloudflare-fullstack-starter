import { D1Dialect } from "kysely-d1";

export type D1DatabaseType = ConstructorParameters<typeof D1Dialect>[0]["database"];

export type AppEnv = {
	DB: D1DatabaseType;
	ENVIRONMENT?: string;
	RESEND_API_KEY?: string;
	// Google OAuth credentials (optional)
	GOOGLE_CLIENT_ID?: string;
	GOOGLE_CLIENT_SECRET?: string;
};

