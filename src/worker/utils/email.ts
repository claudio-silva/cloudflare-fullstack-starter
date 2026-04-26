import { EmailMessage } from "cloudflare:email";
import { Resend } from "resend";
import { config } from "../../config";
import type { CloudflareEmailSendBinding, EmailProvider } from "../types/env";

export type EmailSender = {
	provider: EmailProvider;
	sendVerificationEmail: (params: { to: string; subject: string; html: string }) => Promise<void>;
};

type EmailEnv = {
	EMAIL_PROVIDER?: EmailProvider;
	EMAIL_API_KEY?: string;
	SEND_EMAIL?: CloudflareEmailSendBinding;
};

export function resolveEmailProvider(env: Pick<EmailEnv, "EMAIL_PROVIDER">): EmailProvider {
	return env.EMAIL_PROVIDER ?? config.email.defaultProvider;
}

function sanitizeHeaderValue(value: string): string {
	return value.replace(/[\r\n]+/g, " ").trim();
}

function encodeHeaderValue(value: string): string {
	const sanitized = sanitizeHeaderValue(value);
	if (/^[\x20-\x7E]*$/.test(sanitized)) {
		return sanitized;
	}

	const bytes = new TextEncoder().encode(sanitized);
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return `=?UTF-8?B?${btoa(binary)}?=`;
}

function formatAddressHeader(name: string, email: string): string {
	const escapedName = sanitizeHeaderValue(name).replace(/["\\]/g, "\\$&");
	return `"${escapedName}" <${sanitizeHeaderValue(email)}>`;
}

function createHtmlEmailMessage(to: string, subject: string, html: string): EmailMessage {
	const fromAddress = config.email.fromAddress;
	const raw = [
		`From: ${formatAddressHeader(config.appName, fromAddress)}`,
		`To: ${sanitizeHeaderValue(to)}`,
		`Subject: ${encodeHeaderValue(subject)}`,
		"MIME-Version: 1.0",
		"Content-Type: text/html; charset=UTF-8",
		"Content-Transfer-Encoding: 8bit",
		"",
		html,
	].join("\r\n");

	return new EmailMessage(fromAddress, to, raw);
}

function createCloudflareEmailSender(env: Pick<EmailEnv, "SEND_EMAIL">): EmailSender {
	if (!env.SEND_EMAIL) {
		throw new Error("SEND_EMAIL binding is required when EMAIL_PROVIDER=cloudflare");
	}

	return {
		provider: "cloudflare",
		async sendVerificationEmail({ to, subject, html }) {
			console.log(`[EMAIL] Sending auth email via Cloudflare: subject=${subject}, to=${to}`);
			const message = createHtmlEmailMessage(to, subject, html);
			const result = await env.SEND_EMAIL!.send(message);
			console.log(`[EMAIL] Cloudflare email sent: messageId=${result.messageId}`);
		},
	};
}

function createResendEmailSender(env: Pick<EmailEnv, "EMAIL_API_KEY">): EmailSender {
	if (!env.EMAIL_API_KEY) {
		throw new Error("EMAIL_API_KEY is required when EMAIL_PROVIDER=resend");
	}

	const resend = new Resend(env.EMAIL_API_KEY);
	const fromAddress = `${config.appName} <${config.email.fromAddress}>`;

	return {
		provider: "resend",
		async sendVerificationEmail({ to, subject, html }) {
			console.log(`[EMAIL] Sending auth email via Resend: subject=${subject}, to=${to}`);
			const result = await resend.emails.send({
				from: fromAddress,
				to,
				subject,
				html,
			});

			if (result.error) {
				throw new Error(result.error.message || "Failed to send email via Resend");
			}
		},
	};
}

export function createEmailSender(env: EmailEnv): EmailSender {
	const provider = resolveEmailProvider(env);

	switch (provider) {
		case "cloudflare":
			return createCloudflareEmailSender(env);
		case "resend":
			return createResendEmailSender(env);
		default:
			throw new Error(`Unsupported EMAIL_PROVIDER: ${provider}`);
	}
}
