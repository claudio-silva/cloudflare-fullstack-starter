import { config } from "../../../config";
import type { AppEnv } from "../../types/env";
import { createCloudflareEmailSender } from "./cloudflare";
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
	const factory = (adapters as Record<string, EmailAdapterFactory>)[provider];
	if (!factory) {
		throw new Error(`Unknown email provider "${provider}". Available: ${Object.keys(adapters).join(", ")}`);
	}
	return factory(env, { name: config.appName, address: config.email.fromAddress });
}
