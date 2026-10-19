# Databases: D1 by default, other databases when you need them

Cloudflare D1 is the default: it runs at the edge next to the Worker, needs no credentials, and all the starter tooling (`db:*` scripts, migrations, backups, time-travel, seeds, the auth CLI, tests) is built around it. It is not mandatory. This guide says what is portable, what is not, and which of three paths to take when a project needs something else.

## The seam

Application code gets its connection from one function, `createDb(env)` in `src/worker/db.ts`. Routes, middleware and Better Auth never build a Kysely instance or name a dialect, so changing or adding a database happens there. Table types live in `src/worker/types/database.ts` (`AuthDatabase` for Better Auth tables, `Database` for everything Kysely sees).

## What is portable and what is not

| Layer | Portability |
|---|---|
| **Kysely query code** (`selectFrom`, `where`, ...) | Mostly portable. Kysely ships dialects for SQLite, PostgreSQL, MySQL and MSSQL, and the starter's own queries use no raw SQL. Portability ends at raw `sql` snippets, dialect functions, and column types (booleans, timestamps, JSON). |
| **Schema / migrations** (`migrations/*.sql`) | **Not portable.** They are SQLite DDL (integer timestamps, `INSERT OR ...`, a trigger) run by `wrangler d1 migrations`. Another database needs its own migration tool and rewritten DDL. |
| **Starter tooling** (`bin/db.ts`, backups, time-travel, test pool `applyD1Migrations`) | **D1-specific.** Replace or drop it for a non-D1 database. |
| **Connectivity** | Workers cannot open a plain TCP pool like a Node server. Use a driver built for it (an HTTP/WebSocket driver offered by the provider) or a Cloudflare Hyperdrive binding in front of Postgres/MySQL. |

On SQLite vs PostgreSQL vs MySQL: SQLite SQL is somewhat closer to PostgreSQL (standard-style `ON CONFLICT`, `RETURNING`, double-quoted identifiers, CTEs, window functions) than to MySQL (backtick quoting, `ON DUPLICATE KEY`, different `LIMIT` and upsert forms). That helps queries, but the schema still needs a real translation either way: SQLite's loose typing, integer-as-boolean/timestamp columns, limited `ALTER TABLE`, and no native uuid/enum/array/JSON types do not map one-to-one. Plan a deliberate migration, not a find-and-replace.

## Three paths

### Path 1: D1 only (default)
Nothing to do. Add tables with migrations, types in `database.ts`, queries with `createDb(c.env)`.

### Path 2: D1 for auth + another store for domain data (recommended when the project wants a provider)
Keep auth, sessions, the auth CLI and all tooling on D1, untouched. The application's own data lives elsewhere:

- **Kysely over SQL:** if the provider offers a SQL path (Postgres via a Hyperdrive binding or the provider's serverless driver), add a second connection factory next to `createDb` (for example `createAppDb(env)`) with its own Kysely dialect and its own table types. Keep the two schemas separate; there are no cross-database joins.
- **Provider API/SDK:** if the project prefers the provider's own client (a REST/JS SDK, row-level-security APIs, realtime), do not force it behind Kysely. Wrap it in a small data-access module per feature (for example `src/worker/data/items.ts` exposing `listItems(env, userId)`), use the provider's secret from `.env.<env>`, and let routes call those functions. Swapping providers later then touches only `data/`.

Why this is the safe default: every authenticated request reads the session. D1 serves it at the edge in the same data center; an external database adds a network round trip to every request, and the starter's auth/CLI/test tooling keeps working unchanged.

### Path 3: Move auth to another database too
Only when the project must have a single external database. It is real work: new Kysely dialect in `createDb`, Better Auth schema recreated in that database (its `database` option takes the Kysely instance, so no Better Auth rewrite), new migration tooling and DDL, replace the D1-specific scripts (`db:*`) and the test setup, and accept the per-request latency. Do it deliberately, on a branch, and update `UPGRADING.md`-style notes for the project because starter upgrades will touch these files.

## Choosing (agents)

1. Ask what the project's data layer really needs (relational SQL? provider features such as realtime or RLS? an existing production database?).
2. Prefer Path 1; if a provider is wanted or already in use, propose Path 2 and explain the latency/consistency trade-offs; only offer Path 3 when a single external database is a hard requirement.
3. Whatever the path, route all connections through factory functions beside `createDb`, never inline in routes.
