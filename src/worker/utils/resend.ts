import { Resend } from "resend";

export type EmailSender = {
	sendVerificationEmail: (params: { to: string; subject: string; html: string }) => Promise<void>;
};

export function createResend(apiKey?: string): Resend {
	if (!apiKey) {
		throw new Error("RESEND_API_KEY is required but not provided");
	}
	return new Resend(apiKey);
}

export function getResend(env: { RESEND_API_KEY?: string }): Resend {
	if (!env.RESEND_API_KEY) {
		throw new Error("RESEND_API_KEY is required but not provided in environment");
	}
	return createResend(env.RESEND_API_KEY);
}

/**
 * Default Resend-backed email sender. Other providers can be added later by
 * implementing the EmailSender interface and swapping the wiring in auth middleware.
 */
export function createResendEmailSender(env: { RESEND_API_KEY?: string }): EmailSender {
	const resend = getResend(env);
	return {
		async sendVerificationEmail({ to, subject, html }) {
			const result = await resend.emails.send({
				from: "My App <noreply@example.com>",
				to,
				subject,
				html,
			});

			if (result.error) {
				throw new Error(result.error.message || "Failed to send email");
			}
		},
	};
}
