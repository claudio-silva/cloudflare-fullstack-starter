import { env } from "cloudflare:workers";
import { createDb, databaseKind } from "../src/worker/db";
import { migrateDatabase } from "../src/worker/db/migrations";

await migrateDatabase(createDb(env), { kind: databaseKind });
