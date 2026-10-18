import { config } from "../../config";

export type EmailSender = {
	sendEmail: (params: { to: string; subject: string; html: string; text?: string }) => Promise<void>;
};

type EmailEnv = {
	EMAIL?: SendEmail;
};

/**
 * Cloudflare Email Service sender, using the native `send_email` binding
 * (`env.EMAIL.send({ from, to, subject, text, html })`).
 */
export function createEmailSender(env: EmailEnv): EmailSender {
	const binding = env.EMAIL;
	if (!binding) {
		throw new Error("EMAIL binding is not configured (see [[send_email]] in wrangler.toml)");
	}

	return {
		async sendEmail({ to, subject, html, text }) {
			console.log(`[EMAIL] Sending email: subject=${subject}, to=${to}`);
			const result = await binding.send({
				from: { name: config.appName, email: config.email.fromAddress },
				to,
				subject,
				html,
				text: text ?? htmlToText(html),
			});
			console.log(`[EMAIL] Email sent: messageId=${result.messageId}`);
		},
	};
}

/** Minimal plain-text fallback derived from an HTML body (keeps link targets). */
export function htmlToText(html: string): string {
	return html
		.replace(/<(style|head|title)[\s\S]*?<\/\1>/gi, "")
		.replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
		.replace(/<\/(p|div|h[1-6]|tr)>|<br\s*\/?>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&amp;/g, "&")
		.replace(/[ \t]+/g, " ")
		.replace(/\n\s*\n+/g, "\n\n")
		.trim();
}
