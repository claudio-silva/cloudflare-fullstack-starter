# Email

The starter sends transactional email (verification, password reset) through a swappable adapter. **Cloudflare Email Service** is the default (native `send_email` binding, no API key, cheapest and simplest on this platform); any other provider can be added behind the same interface.

## How it works

Email goes through an **adapter** (see "Platform Philosophy" in `AGENTS.md`). Feature code (Better Auth hooks) only calls `createEmailSender(env).sendEmail({ to, subject, html, text? })` from `src/worker/adapters/email`. The provider is chosen with `config.email.provider` in `src/config.ts`:

The only adapter shipped is `cloudflare` (default): Cloudflare Email Service through the `[[send_email]]` binding named `EMAIL` in `wrangler.toml`, sender domain onboarded in Cloudflare, no API key. It is the simplest and cheapest option on this platform, but not mandatory: add your own adapter (below) for any other provider.

- Templates: `src/worker/utils/email-templates.ts` (verification, password reset). Branding comes from `appName`. A plain-text body is derived from the HTML when `text` is not given.
- Sender: `config.email.fromAddress`. For Cloudflare it must match an entry in `allowed_sender_addresses` in `wrangler.toml` (`npm run init` keeps both in sync).
- Local development: `AUTH_EMAILS_LOCAL_ENABLED=false` (default) skips sending and disables email verification, so sign-up signs the user in directly. Set it to `true` in `.env.local` to send real email locally (the local Cloudflare `EMAIL` binding uses `remote = true`).

### Using a different provider (or converting a project that already has one)

1. Write an adapter (contract below), register it, and set `config.email.provider` to its name.
2. Add the provider's secret to `.env.local` / `.env.preview` / `.env.production` (synced to the Worker on deploy) and to `AppEnv`.
3. Optional: delete the `[[send_email]]` blocks from `wrangler.toml`; `vite.config.ts` only injects the binding when it is present.

### Adapter contract

1. Create `src/worker/adapters/email/<name>.ts` exporting `create<Name>EmailSender(env, from): EmailSender`. It must implement `sendEmail({ to, subject, html, text? })`, throw a clear error when its secret is missing, and throw on non-success responses.
2. Register it in the `adapters` map in `src/worker/adapters/email/index.ts`.
3. Add its secret to `AppEnv` (`src/worker/types/env.ts`) and to the env templates (commented).
4. Add a test in `test/email.test.ts` (stub `fetch` or the provider SDK).
5. Set `config.email.provider` to the new name.

### Example: an adapter for a third-party HTTP API (Resend)

Illustrative only; it is not part of the starter. Adjust the endpoint and payload to your provider.

```ts
// src/worker/adapters/email/resend.ts
import { htmlToText } from "../../utils/html-to-text";
import type { EmailIdentity, EmailSender } from "./types";

export function createResendEmailSender(env: { RESEND_API_KEY?: string }, from: EmailIdentity): EmailSender {
	const apiKey = env.RESEND_API_KEY;
	if (!apiKey) throw new Error("RESEND_API_KEY is required when config.email.provider is \"resend\"");

	return {
		async sendEmail({ to, subject, html, text }) {
			const response = await fetch("https://api.resend.com/emails", {
				method: "POST",
				headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
				body: JSON.stringify({
					from: `${from.name} <${from.address}>`,
					to: [to],
					subject,
					html,
					text: text ?? htmlToText(html),
				}),
			});
			if (!response.ok) throw new Error(`Email request failed (${response.status}): ${await response.text()}`);
		},
	};
}
```

Then register `resend: createResendEmailSender` in the `adapters` map, add `RESEND_API_KEY?: string` to `AppEnv`, and set `provider: "resend"` in `src/config.ts`.

## Domain onboarding (Cloudflare provider)

1. Put the sending domain's DNS on Cloudflare (Cloudflare nameservers).
2. In the dashboard open **Compute (Workers) → Email Service → Onboard Domain** and select the domain.
3. Cloudflare adds the **SPF, DKIM and DMARC** records for you; wait until the domain shows as verified.
4. Set the sender address (for example `noreply@yourdomain.com`) via `npm run init` or by editing `src/config.ts` and `wrangler.toml` together.
5. Deploy. Test with a sign-up on preview with a real address.

Email Service is in public beta; check the Cloudflare docs for current limits and pricing.

## Receiving email (optional)

Inbound mail is Cloudflare-specific (Email Routing) and independent of the sending adapter.

Inbound mail uses **Email Routing** and a Worker `email()` handler. It is not wired in by default; `src/worker/email-handler.example.ts` shows the shape and how to export it next to the Hono app:

```ts
import { email } from "./email-handler.example";
export default { fetch: app.fetch, email };
```

Then enable Email Routing for the domain and route an address (or catch-all) to the Worker. Typical uses: ingesting attachments, support inboxes, forwarding.
