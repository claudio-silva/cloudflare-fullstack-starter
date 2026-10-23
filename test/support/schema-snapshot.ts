/**
 * Re-exported from the Worker so tests and the migration guard compare schemas
 * the same way. See `src/worker/db/schema-snapshot.ts`.
 */
export { schemaSnapshot, diffSnapshots, describeChange } from "../../src/worker/db/schema-snapshot";
export type { SchemaSnapshot, SchemaTable, SchemaColumn, SchemaChange } from "../../src/worker/db/schema-snapshot";
