import type { Kysely } from "kysely";
import type { Database } from "../../types/database";
import type { DatabaseKind } from "../index";

export type Seed = (db: Kysely<Database>, ctx: { kind: DatabaseKind }) => Promise<void>;

/**
 * Seed registry. A seed is an idempotent function that inserts bootstrap data; it is run on
 * demand (`npm run db:seed -- --file <name>`), never automatically. Register yours here:
 *
 *   import { adminBootstrap } from "./admin-bootstrap";
 *   export const seeds: Record<string, Seed> = { "admin-bootstrap": adminBootstrap };
 *
 * See docs/DATABASES.md (Seeds) for an idempotent example.
 */
export const seeds: Record<string, Seed> = {};
