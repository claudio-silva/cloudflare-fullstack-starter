# Email (Cloudflare Email Service)

The starter sends transactional email (verification, password reset) through **Cloudflare Email Service only**, using the native `send_email` binding. No third-party provider and no API key.

## How it works

- Binding: `[[send_email]]` named `EMAIL` in `wrangler.toml` (one per environment).
- Code: `src/worker/utils/email.ts` calls `env.EMAIL.send({ from, to, subject, text, html })`. A plain-text body is derived from the HTML when `text` is not given.
- Templates: `src/worker/utils/email-templates.ts` (verification, password reset). Branding comes from `src/config.ts` (`appName`).
- Sender: `config.email.fromAddress` in `src/config.ts` must match an entry in `allowed_sender_addresses` in `wrangler.toml`. `npm run init` keeps both in sync.
- Local development: `AUTH_EMAILS_LOCAL_ENABLED=false` (default) skips sending and disables email verification, so sign-up signs the user in directly. Set it to `true` in `.env.local` to send real email locally (the local `EMAIL` binding uses `remote = true`).

## Domain onboarding

1. Put the sending domain's DNS on Cloudflare (Cloudflare nameservers).
2. In the dashboard open **Compute (Workers) → Email Service → Onboard Domain** and select the domain.
3. Cloudflare adds the **SPF, DKIM and DMARC** records for you; wait until the domain shows as verified.
4. Set the sender address (for example `noreply@yourdomain.com`) via `npm run init` or by editing `src/config.ts` and `wrangler.toml` together.
5. Deploy. Test with a sign-up on preview with a real address.

Email Service is in public beta; check the Cloudflare docs for current limits and pricing.

## Receiving email (optional)

Inbound mail uses **Email Routing** and a Worker `email()` handler. It is not wired in by default; `src/worker/email-handler.example.ts` shows the shape and how to export it next to the Hono app:

```ts
import { email } from "./email-handler.example";
export default { fetch: app.fetch, email };
```

Then enable Email Routing for the domain and route an address (or catch-all) to the Worker. Typical uses: ingesting attachments, support inboxes, forwarding.
