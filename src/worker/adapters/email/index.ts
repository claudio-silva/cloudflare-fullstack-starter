import { config } from "../../../config";
import type { AppEnv } from "../../types/env";
import { createCloudflareEmailSender } from "./cloudflare";
import { isDemo } from "../../middleware/demo";
import type { EmailIdentity, EmailSender } from "./types";

export type { EmailMessage, EmailSender, EmailIdentity } from "./types";

type EmailAdapterFactory = (env: AppEnv, from: EmailIdentity) => EmailSender;

/**
 * Adapter registry. To add a provider: implement `EmailSender` in a new file
 * next to this one, register it here, and extend the `provider` union in
 * `src/config.ts`. See docs/EMAIL.md.
 */
const adapters = {
	cloudflare: createCloudflareEmailSender,
} satisfies Record<string, EmailAdapterFactory>;

export type EmailProvider = keyof typeof adapters;

export function createEmailSender(env: AppEnv, provider: string = config.email.provider): EmailSender {
	// A public demo must never send mail: see src/worker/middleware/demo.ts.
	if (isDemo(env)) {
		return { sendEmail: async ({ subject }) => console.warn("[email] demo mode: not sent", { subject }) };
	}
	const factory = (adapters as Record<string, EmailAdapterFactory>)[provider];
	if (!factory) {
		throw new Error(`Unknown email provider "${provider}". Available: ${Object.keys(adapters).join(", ")}`);
	}
	return factory(env, { name: config.appName, address: config.email.fromAddress });
}
