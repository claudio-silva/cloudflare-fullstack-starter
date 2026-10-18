import { DurableObject } from "cloudflare:workers";

/**
 * Minimal SQLite-backed Durable Object example: a named counter.
 *
 * Wiring (all three are required, see docs/VITE_CLOUDFLARE_BRIDGE.md):
 *  1. `[[durable_objects.bindings]]` in wrangler.toml (top level)
 *  2. a `[[migrations]]` entry with a `tag` and `new_sqlite_classes`
 *  3. the class exported from the Worker entry (`src/worker/index.ts`)
 *
 * Rename or delete this class when you add your own; changing a class name
 * after deployment needs a new migration tag (`renamed_classes`).
 */
export class ExampleCounter extends DurableObject {
	async increment(): Promise<number> {
		const current = (await this.ctx.storage.get<number>("count")) ?? 0;
		const next = current + 1;
		await this.ctx.storage.put("count", next);
		return next;
	}

	async value(): Promise<number> {
		return (await this.ctx.storage.get<number>("count")) ?? 0;
	}
}
