import { describe, expect, it, vi } from "vitest";
import { createEmailSender } from "../src/worker/adapters/email";
import type { AppEnv } from "../src/worker/types/env";

const message = { to: "user@example.com", subject: "Hi", html: '<p>Hello <a href="https://x.test/a">link</a></p>' };

describe("email adapters", () => {
	it("cloudflare adapter sends through the EMAIL binding with a text fallback", async () => {
		const send = vi.fn().mockResolvedValue({ messageId: "m1" });
		const sender = createEmailSender({ EMAIL: { send } } as unknown as AppEnv, "cloudflare");
		await sender.sendEmail(message);

		expect(send).toHaveBeenCalledOnce();
		expect(send.mock.calls[0][0]).toMatchObject({
			to: "user@example.com",
			subject: "Hi",
			text: expect.stringContaining("link (https://x.test/a)"),
		});
	});

	it("cloudflare adapter requires the binding", () => {
		expect(() => createEmailSender({} as AppEnv, "cloudflare")).toThrow(/EMAIL binding/);
	});

	it("rejects unknown providers", () => {
		expect(() => createEmailSender({} as AppEnv, "nope")).toThrow(/Unknown email provider/);
	});
});
