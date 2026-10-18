/**
 * OPTIONAL: inbound email example (Cloudflare Email Routing → Worker).
 *
 * Not wired in by default. To enable:
 *  1. Enable Email Routing for your domain in the Cloudflare dashboard and
 *     route an address (or catch-all) to this Worker ("Send to a Worker").
 *  2. Export the handler from the Worker entry, next to the Hono app:
 *
 *       import { email } from "./email-handler.example";
 *       export default { fetch: app.fetch, email };
 *
 * Handlers may also take `(message, env, ctx)`; omitted here as unused.
 * See docs/EMAIL.md.
 */
export async function email(message: ForwardableEmailMessage): Promise<void> {
	console.log(`[EMAIL-IN] from=${message.from} to=${message.to} size=${message.rawSize}`);

	// Read the raw MIME message (parse with a library such as `postal-mime`).
	const raw = await new Response(message.raw).arrayBuffer();
	console.log(`[EMAIL-IN] read ${raw.byteLength} bytes`);

	// Reject unwanted mail (sender gets a bounce):
	// message.setReject("Address not accepted");

	// Or forward to a verified destination address:
	// await message.forward("someone@example.com");
}
