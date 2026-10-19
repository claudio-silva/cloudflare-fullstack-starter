import { htmlToText } from "../../utils/html-to-text";
import type { EmailIdentity, EmailSender } from "./types";

/**
 * Default adapter: Cloudflare Email Service through the native `send_email`
 * binding (`[[send_email]]` named `EMAIL` in wrangler.toml). No API key.
 */
export function createCloudflareEmailSender(env: { EMAIL?: SendEmail }, from: EmailIdentity): EmailSender {
	const binding = env.EMAIL;
	if (!binding) {
		throw new Error("EMAIL binding is not configured (see [[send_email]] in wrangler.toml)");
	}

	return {
		async sendEmail({ to, subject, html, text }) {
			console.log(`[EMAIL] Sending via Cloudflare: subject=${subject}, to=${to}`);
			const result = await binding.send({
				from: { name: from.name, email: from.address },
				to,
				subject,
				html,
				text: text ?? htmlToText(html),
			});
			console.log(`[EMAIL] Sent via Cloudflare: messageId=${result.messageId}`);
		},
	};
}
