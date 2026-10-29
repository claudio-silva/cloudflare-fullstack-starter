# Databases

The starter is **database-agnostic by design**: schema creation, migrations, seeds, auth and the application queries run unchanged on **Cloudflare D1 (SQLite, the default)**, **PostgreSQL** and **MySQL**. The same behavioural test suite runs against D1, PGlite, a real PostgreSQL 17 server and a real MySQL 8.4 server. The core stays on Cloudflare Workers; the database is your choice.

Because D1 is the default, anything D1-specific is called out below (time-travel). Backup and restore work on every supported database.

## The seam: `src/worker/db/index.ts`

| Export | Purpose |
|---|---|
| `databaseKind` | `"sqlite" \| "postgres" \| "mysql"`. Drives column types, the Better Auth mode and value encoding. |
| `createDb(env)` | The only place a connection is built. Routes, middleware and auth never name a dialect. |
| `dbNow()` / `dbBool()` | Write timestamps and booleans in the form the driver expects (SQLite: ISO string, 0/1; others: `Date`, boolean). |
| `toIso()` | Normalise a driver timestamp to an ISO string for API output. |
| `ignoreConflict()` | Portable "insert if absent" (`ON CONFLICT DO NOTHING` / MySQL `INSERT IGNORE`). |

Table types are in `src/worker/types/database.ts` (`AuthDatabase` for Better Auth tables; add yours to `Database`).

## Portability: starter code vs your code

**Starter-owned database code** (Better Auth tables, the CLI routes, migrations 0001-0003, the seed helpers) is written in a portable subset so it works on every supported database and is tested on all of them. Keep it portable when you modify those files.

**Your own code is not restricted.** After you choose your database, use whatever it supports: transactions on PostgreSQL/MySQL, `RETURNING` on PostgreSQL/SQLite, native column types, raw SQL, vendor features. You can also trim the other databases from `test/cross-db` and CI once you are sure you will not switch. The notes below only matter if you want to keep the option of changing database later, or when you touch starter-owned code.

Differences the starter works around (and the helper it uses):

| Difference | Starter's approach |
|---|---|
| **Column types.** MySQL cannot index unbounded `text`; MySQL has no `timestamptz` | `columnTypes(kind)` in `src/worker/db/migrations/columns.ts`: ids/emails/tokens `varchar(255)`, flags `boolean`, instants `timestamptz` (MySQL `datetime(3)`) |
| **Timestamps/booleans on Better Auth tables.** The adapter sends `Date`/boolean on PostgreSQL and MySQL, so epoch-integer columns fail there | Real datetime/boolean columns; write with `dbNow()`/`dbBool()`, read with `toIso()`/`Boolean()`. If your code writes to the auth tables, use the helpers (or match your database's types yourself) |
| **Transactions.** D1 does not support interactive transactions (`db.transaction()` throws); PostgreSQL and MySQL do | Starter code does not use them. Your code on PostgreSQL/MySQL may |
| **`RETURNING`.** Not available in MySQL | Starter code inserts, then selects |
| **`LIKE` case sensitivity.** Insensitive on SQLite/MySQL, sensitive on PostgreSQL | `lower(col) like lower(?)` in the CLI user search |
| **Idempotent insert.** `ON CONFLICT DO NOTHING` (SQLite/PostgreSQL) vs `INSERT IGNORE` (MySQL) | `ignoreConflict()` |
| **Schema alterations.** SQLite cannot `ALTER COLUMN` or add constraints to existing tables | Starter migrations only use the Kysely schema builder operations all three support; rebuild a table when needed |

## Migrations: baseline + incremental

```
src/worker/db/migrations/
  baseline.ts              # whole schema in its final form (new databases)
  incremental/0001_...ts   # progressive history (existing databases)
  index.ts                 # createMigrations(kind), createBaseline(kind)
  migrate.ts               # the runner
```

| Database state | What the runner does |
|---|---|
| **New** (nothing applied) | Runs the **baseline once**, records the squashed migration names as applied. Fast, no history replay. |
| **Existing** | Runs only the pending **incremental** migrations (Kysely `Migrator`; state in `kysely_migration`). |
| **Legacy D1** (tracked by the old `wrangler d1 migrations`) | **Adopts** it: marks matching migrations as applied (via each migration's `legacyName`), then runs the rest. |

A test (`test/support/cross-db-suite.ts`) proves baseline and incremental give the **same schema** on every database (columns with their types and defaults, indexes, foreign keys), so they cannot drift silently.

### Adding a migration
1. Create `incremental/0004_<name>.ts` exporting a factory `(kind) => ({ up })` (copy `0003_...`), using `columnTypes(kind)` to stay portable (or your database's native DDL once you have chosen it). Register it in `migrations/index.ts`. Never edit or rename an applied one.
2. Apply the same change to `baseline.ts` and append the new name to its `squashes`.
3. Update the table types in `src/worker/types/database.ts`.
4. `npm test` (the drift test fails if baseline and incrementals disagree).

### Where migrations run
Inside the Worker, through `POST /api/cli/migrate` (protected by `CLI_API_KEY`; same mechanism as the user CLI):

```bash
npm run db:migrate                    # local (dev server must be running) 
npm run db:migrate:preview:safe       # backup first, then migrate
npm run db:migrate:production:safe
npm run db:migrations:list[:preview|:production]
```

**Local development migrates automatically** on the first API request, so `npm run dev` on a fresh checkout just works. Preview/production are migrated by the deploy commands (`deploy:preview`, `deploy:production`) right after `wrangler deploy`, or explicitly with `db:migrate:<env>:safe`. Because the new code is live before the schema changes, keep migrations additive (see [DEPLOYMENT.md](DEPLOYMENT.md)).

## Seeds

Seeds are idempotent TypeScript functions registered in `src/worker/db/seeds/index.ts`; they are not tracked and run only on demand: `npm run db:seed -- --env local --file <name>`. Use `ignoreConflict()` so they work on every database:

```ts
// src/worker/db/seeds/admin-bootstrap.ts
import { dbNow, ignoreConflict } from "..";
import type { Seed } from ".";

export const adminBootstrap: Seed = async (db, { kind }) => {
	const now = dbNow(kind);
	await ignoreConflict(
		db.insertInto("users").values({ id: "seed-admin", email: "admin@example.com", role: "admin", createdAt: now, updatedAt: now }),
		kind,
	).execute();
};
// register: export const seeds = { "admin-bootstrap": adminBootstrap };
```

(Users that must sign in need a password: create them with `npm run auth create-user`.)

## Choosing a setup

### Path 1: D1 only (default)
Nothing to do.

### Path 2: D1 for auth + another store for domain data (usually best when a provider is wanted)
Keep auth, sessions, the CLI and D1 tooling untouched; put application data elsewhere. Every authenticated request reads the session, which D1 serves at the edge; an external database adds a network round trip to each request.

- **Kysely over SQL:** add a second factory beside `createDb` (for example `createAppDb(env)`) with its own dialect and its own table types. No cross-database joins.
- **Provider API/SDK** (Supabase, Neon, ...): don't force it behind Kysely. Wrap it in one data-access module per feature (`src/worker/data/items.ts` exposing `listItems(env, userId)`), keep the provider secret in `.env.<env>`, and have routes call those functions.

### Path 3: Everything on PostgreSQL or MySQL
Set `databaseKind` and rewrite `createDb` (illustrative; verify driver/Hyperdrive details in Cloudflare's docs):

```ts
// PostgreSQL through a Hyperdrive binding
import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
export const databaseKind: DatabaseKind = "postgres";
export function createDb(env: AppEnv) {
	return new Kysely<Database>({
		dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: env.HYPERDRIVE.connectionString, max: 1 }) }),
	});
}
```

For MySQL use `MysqlDialect` with `mysql2` (pass `timezone: "Z"`, and `disableEval: true` when running in Workers). Then:

- Add the Hyperdrive/connection binding to `wrangler.toml` and `AppEnv`, and the driver to `package.json`.
- Migrations, seeds, auth and tests need **no changes**.
- `db:backup`, `db:restore` and `migrate --safe` keep working: they go through the Worker (`/api/cli/backup/*`, `/api/cli/restore/*`) and read every table of whatever database `createDb` returns. Only `db:time-travel` is D1-specific; for large production databases also use your provider's native backups/point-in-time recovery.
- The starter tests exercise real PostgreSQL and MySQL servers through Node drivers; they do not go through Hyperdrive from a Worker, so smoke-test that connection yourself.

## Testing across databases

```bash
npm test                 # D1 (workerd) + PGlite (embedded PostgreSQL)
npm run test:db:up       # start PostgreSQL 17 and MySQL 8.4 (Docker)
npm run test:db          # everything, including the real servers
npm run test:db:down
```

Env vars `TEST_POSTGRES_URL` / `TEST_MYSQL_URL` select the servers (see `docker-compose.test.yml`); CI starts both as services. Add a new database-touching feature to `test/support/cross-db-suite.ts` and it is checked on every database.

## Choosing (agents)

1. Ask what the data layer really needs (relational SQL? provider features such as realtime or RLS? an existing production database?).
2. Prefer Path 1; if a provider is wanted or already in use, propose Path 2 and explain the latency trade-off; offer Path 3 only when a single external database is a hard requirement.
3. Whatever the path, keep every connection in factory functions beside `createDb`. Do not impose the portable subset on the user's own code; tell them which differences exist and let them decide.
