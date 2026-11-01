import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTACT_PATH, MIN_FILL_MS, composeEmail, handleContact, type ContactEnv } from "../../templates/website/src/contact";

// The product website's contact form (templates/website/src/contact.ts): what
// it sends, to whom, and every case in which it deliberately sends nothing.

const SITE = "https://acme.io";

function post(fields: Record<string, string>, headers: Record<string, string> = {}): Request {
	const body = new URLSearchParams(fields);
	return new Request(`${SITE}${CONTACT_PATH}`, {
		method: "POST",
		body,
		headers: { origin: SITE, referer: `${SITE}/pricing`, accept: "application/json", "cf-connecting-ip": "203.0.113.7", ...headers },
	});
}

const valid = { name: "Ada Lovelace", email: "Ada@Example.org", message: "Do you have a team plan?" };

function mailer() {
	return { send: vi.fn(async () => ({ messageId: "m-1" })) };
}

function configured(extra: Partial<ContactEnv> = {}): ContactEnv & { CONTACT_EMAIL: ReturnType<typeof mailer> } {
	return { ENVIRONMENT: "production", CONTACT_EMAIL: mailer(), CONTACT_TO: "team@acme.io", CONTACT_FROM: "hello@acme.io", ...extra } as never;
}

async function json(response: Response) {
	return (await response.json()) as { ok: boolean; outcome: string; message: string; fields?: Record<string, string> };
}

beforeEach(() => {
	vi.spyOn(console, "log").mockImplementation(() => {});
	vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("the contact form", () => {
	it("emails you the message, with the visitor as the Reply-To and never as a recipient", async () => {
		const env = configured();
		const response = await handleContact(post(valid, { "cf-ipcountry": "PT" }), env);

		expect(response.status).toBe(200);
		expect(await json(response)).toMatchObject({ ok: true, outcome: "sent" });
		expect(env.CONTACT_EMAIL.send).toHaveBeenCalledOnce();
		const [email] = env.CONTACT_EMAIL.send.mock.calls[0] as unknown as [ReturnType<typeof composeEmail>];
		expect(email.to).toBe("team@acme.io");
		expect(email.from).toEqual({ name: "__APP_NAME__ website", email: "hello@acme.io" });
		expect(email.replyTo).toEqual({ name: "Ada Lovelace", email: "ada@example.org" });
		expect(email.text).toContain("Do you have a team plan?");
		expect(email.text).toContain("Sent from the contact form on https://acme.io/pricing · Country: PT");
	});

	it("keeps a name from smuggling in a header, and the visitor's text out of the markup", () => {
		const email = composeEmail({ name: "Eve\r\nBcc: all@x.io", email: "e@x.io", message: "<script>alert(1)</script>" }, "f@acme.io", "t@acme.io", {
			page: SITE,
			country: "",
		});
		expect(email.subject).not.toMatch(/[\r\n]/);
		expect(email.html).not.toContain("<script>");
		expect(email.html).toContain("&lt;script&gt;");
	});

	it("says which fields are wrong, in words for the visitor", async () => {
		const env = configured();
		const response = await handleContact(post({ name: "", email: "not-an-address", message: "" }), env);
		expect(response.status).toBe(422);
		const body = await json(response);
		expect(Object.keys(body.fields ?? {})).toEqual(["name", "email", "message"]);
		expect(env.CONTACT_EMAIL.send).not.toHaveBeenCalled();
	});

	it("tells a bot it worked, and sends nothing", async () => {
		const env = configured();
		const trapped = await handleContact(post({ ...valid, website: "https://spam.example" }), env);
		const hasty = await handleContact(post({ ...valid, started: String(Date.now() - MIN_FILL_MS / 2) }), env);
		expect(await json(trapped)).toMatchObject({ ok: true, outcome: "sent" });
		expect(await json(hasty)).toMatchObject({ ok: true, outcome: "sent" });
		expect(env.CONTACT_EMAIL.send).not.toHaveBeenCalled();

		// A person who took their time is let through.
		await handleContact(post({ ...valid, started: String(Date.now() - MIN_FILL_MS * 4) }), env);
		expect(env.CONTACT_EMAIL.send).toHaveBeenCalledOnce();
	});

	it("refuses a form on another site posting here", async () => {
		const env = configured();
		const response = await handleContact(post(valid, { origin: "https://elsewhere.example" }), env);
		expect(response.status).toBe(403);
		expect(env.CONTACT_EMAIL.send).not.toHaveBeenCalled();
	});

	it("limits messages per visitor", async () => {
		const limit = vi.fn(async () => ({ success: false }));
		const env = configured({ CONTACT_RATE_LIMITER: { limit } });
		const response = await handleContact(post(valid), env);
		expect(response.status).toBe(429);
		expect(limit).toHaveBeenCalledWith({ key: "203.0.113.7" });
		expect(env.CONTACT_EMAIL.send).not.toHaveBeenCalled();
	});

	it("in a demo, checks the message and sends nothing", async () => {
		const env = configured({ DEMO_MODE: "1" });
		const response = await handleContact(post(valid), env);
		expect(await json(response)).toMatchObject({ ok: true, outcome: "demo" });
		expect(env.CONTACT_EMAIL.send).not.toHaveBeenCalled();
		// …but still says what is wrong with a bad one.
		expect((await handleContact(post({ ...valid, email: "x" }), env)).status).toBe(422);
	});

	it("locally, writes the message to the terminal instead of sending it", async () => {
		const response = await handleContact(post(valid), { ENVIRONMENT: "local" });
		expect(await json(response)).toMatchObject({ ok: true, outcome: "logged" });
		expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Do you have a team plan?"));
	});

	it("deployed without an address to send to, says it is not set up", async () => {
		const env = configured({ CONTACT_TO: "" });
		const response = await handleContact(post(valid), env);
		expect(response.status).toBe(503);
		expect(await json(response)).toMatchObject({ ok: false, outcome: "unavailable" });
	});

	it("when Email Service refuses, says so without the details", async () => {
		const env = configured();
		env.CONTACT_EMAIL.send.mockRejectedValueOnce(Object.assign(new Error("Attempting to send from unverified domain"), { code: "E_SENDER_NOT_VERIFIED" }));
		const response = await handleContact(post(valid), env);
		expect(response.status).toBe(502);
		const body = await json(response);
		expect(body.message).not.toContain("unverified");
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining("E_SENDER_NOT_VERIFIED"));
	});

	it("answers a plain form post with a redirect back to the form", async () => {
		const response = await handleContact(post(valid, { accept: "text/html" }), configured());
		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe("/pricing#contact-sent");
	});

	it("only takes POST", async () => {
		const response = await handleContact(new Request(`${SITE}${CONTACT_PATH}`), configured());
		expect(response.status).toBe(405);
	});
});
