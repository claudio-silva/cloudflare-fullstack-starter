/**
 * The contact form: `POST /api/contact`, sent to your own inbox through
 * Cloudflare Email Service.
 *
 * Cloudflare's free plan sends to the account's **verified destination
 * addresses** (Email Routing → Destination addresses) at no cost, which is
 * exactly what a contact form needs: every message goes to you, never to an
 * address a visitor typed. The visitor's address is only the Reply-To, so
 * answering is one click and the form can never be used to mail a stranger.
 *
 * Configured in wrangler.toml, per environment:
 *   - `CONTACT_EMAIL`, a `[[send_email]]` binding of this Worker's own (not the
 *     app's), its sender allowed by `allowed_sender_addresses`;
 *   - `CONTACT_TO`, where messages go; `CONTACT_FROM`, the sender, an address
 *     on a domain onboarded in Email Service;
 *   - `CONTACT_RATE_LIMITER`, a per-IP limit (optional, but a public form
 *     without one is a mail cannon).
 *
 * What keeps the bots out, cheapest first: a field people never see and bots
 * fill in, a minimum time between loading the page and sending (set by
 * public/js/contact.js, so it only applies when JavaScript ran), the
 * same-origin check and the rate limit. A bot that trips the first two is told
 * its message went through — it learns nothing — and nothing is sent.
 *
 * What it does instead of sending:
 *   - `DEMO_MODE` ("1" or "true"): checks the message, says so, sends nothing.
 *     A public demo must not be a way to fill someone's inbox.
 *   - locally (`ENVIRONMENT = "local"`, no binding): writes the message to the
 *     terminal, so the form can be built and tested without email set up.
 *   - deployed but not configured: answers 503, "not set up yet".
 *
 * Answers JSON to the page's script, and a redirect to a fragment of the page
 * (`#contact-sent`, `#contact-failed`, …) to a plain form post, so the form
 * works — and says what happened — without JavaScript too (styles.css shows
 * the matching notice with `:target`).
 */

export const CONTACT_PATH = "/api/contact";

/** Shown in the subject and the sender's name; replaced with the app's name by `setup:website`. */
const SITE_NAME = "__APP_NAME__";

type Address = string | { email: string; name?: string };

/**
 * A `[[send_email]]` binding (Cloudflare Email Service), as this form uses it:
 * the structured `send()`. Throws an Error with a `code` on failure.
 * Declared here, not in worker-types.d.ts, so the unit tests can import this
 * module without the Worker's ambient types.
 */
export type ContactMailer = {
	send(message: { from: Address; to: Address; replyTo?: Address; subject: string; text?: string; html?: string }): Promise<{ messageId: string }>;
};

/** A `[[ratelimits]]` binding (Workers Rate Limiting). */
export type RateLimiter = {
	limit(options: { key: string }): Promise<{ success: boolean }>;
};

export type ContactEnv = {
	CONTACT_EMAIL?: ContactMailer;
	CONTACT_RATE_LIMITER?: RateLimiter;
	CONTACT_TO?: string;
	CONTACT_FROM?: string;
	DEMO_MODE?: string;
	ENVIRONMENT?: string;
};

/** Limits on what a message may hold. Generous for people, short for scripts. */
export const LIMITS = { name: 100, email: 254, message: 5000, body: 32 * 1024 } as const;

/** Faster than this from page load to send, and it was not typed by a person. */
export const MIN_FILL_MS = 2500;

export type ContactOutcome = "sent" | "demo" | "logged" | "invalid" | "limited" | "unavailable" | "failed";

type Result = { status: number; outcome: ContactOutcome; message: string; fields?: Record<string, string> };

const EMAIL_PATTERN = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;

const isOn = (value: string | undefined) => value === "1" || value === "true";

/** Collapse to one line: a name or a subject must not carry a header of its own. */
const oneLine = (value: string) => value.replace(/[\r\n\t]+/g, " ").trim();

const escapeHtml = (value: string) =>
	value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

export type ContactMessage = { name: string; email: string; message: string };

/** The message, or what is wrong with each field, in words for the visitor. */
export function validate(form: { get(name: string): unknown }): { message: ContactMessage } | { fields: Record<string, string> } {
	const text = (name: string) => (typeof form.get(name) === "string" ? (form.get(name) as string) : "");
	const name = oneLine(text("name"));
	const email = oneLine(text("email")).toLowerCase();
	const message = text("message").replace(/\r\n/g, "\n").trim();

	const fields: Record<string, string> = {};
	if (!name) fields.name = "Please tell us your name.";
	else if (name.length > LIMITS.name) fields.name = `Please keep your name under ${LIMITS.name} characters.`;
	if (!email) fields.email = "Please give an address we can answer.";
	else if (email.length > LIMITS.email || !EMAIL_PATTERN.test(email)) fields.email = "That doesn't look like an email address.";
	if (message.length < 2) fields.message = "Please write a message.";
	else if (message.length > LIMITS.message) fields.message = `Please keep it under ${LIMITS.message} characters.`;

	return Object.keys(fields).length ? { fields } : { message: { name, email, message } };
}

/** The email you receive. The visitor is the Reply-To, never a recipient. */
export function composeEmail(msg: ContactMessage, from: string, to: string, meta: { page: string; country: string }) {
	const subject = oneLine(`${SITE_NAME}: message from ${msg.name}`).slice(0, 200);
	const footer = [`Sent from the contact form on ${meta.page}`, meta.country && `Country: ${meta.country}`].filter(Boolean).join(" · ");
	return {
		from: { name: `${SITE_NAME} website`, email: from },
		to,
		replyTo: { name: msg.name, email: msg.email },
		subject,
		text: `${msg.message}\n\n— ${msg.name} <${msg.email}>\n${footer}\n`,
		html: `<div style="font:15px/1.55 system-ui,sans-serif;white-space:pre-wrap">${escapeHtml(msg.message)}</div>
<p style="font:14px/1.5 system-ui,sans-serif">— ${escapeHtml(msg.name)} &lt;<a href="mailto:${escapeHtml(msg.email)}">${escapeHtml(msg.email)}</a>&gt;</p>
<p style="font:12px/1.5 system-ui,sans-serif;color:#777">${escapeHtml(footer)}</p>`,
	};
}

/** Was the page this came from on our own origin? A form on another site posting here is not a visitor of ours. */
function sameOrigin(request: Request): boolean {
	const origin = request.headers.get("origin");
	if (!origin || origin === "null") return true; // Some privacy settings strip it; the other checks still apply.
	try {
		return new URL(origin).host === new URL(request.url).host;
	} catch {
		return false;
	}
}

async function receive(request: Request, env: ContactEnv): Promise<Result> {
	if (!sameOrigin(request)) return { status: 403, outcome: "failed", message: "This form only accepts messages sent from this site." };
	if (Number(request.headers.get("content-length") ?? 0) > LIMITS.body) {
		return { status: 413, outcome: "invalid", message: "That message is too long to send." };
	}

	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		return { status: 400, outcome: "invalid", message: "The form could not be read. Please try again." };
	}

	const checked = validate(form);
	if ("fields" in checked) {
		return { status: 422, outcome: "invalid", message: "Please check the highlighted fields.", fields: checked.fields };
	}
	const msg = checked.message;

	// Bots: told it worked, so they learn nothing; nothing is sent.
	const started = Number(form.get("started") ?? 0);
	const trap = typeof form.get("website") === "string" && (form.get("website") as string).trim() !== "";
	if (trap || (started > 0 && Date.now() - started < MIN_FILL_MS)) {
		console.log(`[contact] dropped as automated (${trap ? "hidden field filled" : "sent too fast"})`);
		return { status: 200, outcome: "sent", message: "Thanks — your message is on its way." };
	}

	const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
	if (env.CONTACT_RATE_LIMITER) {
		const { success } = await env.CONTACT_RATE_LIMITER.limit({ key: ip });
		if (!success) return { status: 429, outcome: "limited", message: "That's a lot of messages at once. Please wait a minute and try again." };
	}

	if (isOn(env.DEMO_MODE)) {
		console.log(`[contact] demo: message from ${msg.email} checked, not sent`);
		return {
			status: 200,
			outcome: "demo",
			message: "Looks good — but this is a demo, so nothing was sent. In your own project, this is where it reaches your inbox.",
		};
	}

	const page = request.headers.get("referer") ?? new URL(request.url).origin;
	const country = request.headers.get("cf-ipcountry") ?? "";
	if (!env.CONTACT_EMAIL || !env.CONTACT_TO || !env.CONTACT_FROM) {
		if ((env.ENVIRONMENT ?? "local") === "local") {
			const email = composeEmail(msg, env.CONTACT_FROM || "website@localhost", env.CONTACT_TO || "you@localhost", { page, country });
			console.log(`[contact] local: not sent, here is what would be:\n  To: ${email.to}\n  Reply-To: ${msg.email}\n  Subject: ${email.subject}\n\n${email.text}`);
			return { status: 200, outcome: "logged", message: "Received. In local development the message is written to the terminal, not sent." };
		}
		console.error("[contact] not configured: CONTACT_EMAIL binding, CONTACT_TO and CONTACT_FROM are all needed (docs/WEBSITE.md, “The contact form”)");
		return { status: 503, outcome: "unavailable", message: "The contact form isn't set up yet. Please try again later." };
	}

	try {
		const { messageId } = await env.CONTACT_EMAIL.send(composeEmail(msg, env.CONTACT_FROM, env.CONTACT_TO, { page, country }));
		console.log(`[contact] sent: messageId=${messageId}`);
		return { status: 200, outcome: "sent", message: "Thanks — your message is on its way. We'll answer by email." };
	} catch (error) {
		const code = (error as { code?: string }).code ?? "";
		console.error(`[contact] sending failed: ${code} ${error instanceof Error ? error.message : String(error)}`);
		return { status: 502, outcome: "failed", message: "Your message could not be sent just now. Please try again in a little while." };
	}
}

/** `POST /api/contact`. JSON for the page's script; a redirect back to the form for a plain post. */
export async function handleContact(request: Request, env: ContactEnv): Promise<Response> {
	if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST" } });

	const result = await receive(request, env);
	if ((request.headers.get("accept") ?? "").includes("application/json")) {
		const { status, ...body } = result;
		return Response.json({ ok: status < 300, ...body }, { status, headers: { "cache-control": "no-store" } });
	}
	return new Response(null, { status: 303, headers: { location: `${returnPath(request)}#contact-${result.outcome}`, "cache-control": "no-store" } });
}

/** The page the form was on, if it was ours; the home page otherwise. */
function returnPath(request: Request): string {
	try {
		const referer = new URL(request.headers.get("referer") ?? "");
		return referer.host === new URL(request.url).host ? referer.pathname : "/";
	} catch {
		return "/";
	}
}
