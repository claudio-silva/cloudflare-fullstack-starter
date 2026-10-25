# Upgrading & Release Log

> **Audience: AI coding agents (and humans) upgrading a project built on this starter.**
> This log lists only what can **break** an older install when moving to a newer starter version, and the order in which to apply it. Routine dependency bumps are not listed unless they forced a code or schema change.

## How to upgrade (agent procedure)

1. **Find the current version.** Read `starter.version` in the project's `package.json`. If it is missing, the project is *unversioned*: use [Unversioned installs](#unversioned-installs-before-100) to find its baseline.
2. **Find the target.** Latest release tag of the starter (`git ls-remote --tags https://github.com/claudio-silva/cloudflare-fullstack-starter` or the GitHub releases page). Do not upgrade to an arbitrary `main` commit unless asked.
3. **Clone the starter with history and tags** into a temporary directory *outside* the project (`git clone https://github.com/claudio-silva/cloudflare-fullstack-starter /tmp/starter-upstream`). Treat it as read-only reference material.
4. **Read every entry below** between the current (exclusive) and target (inclusive) versions. Plan the stages first; tell the user the plan.
5. **Work on a new git branch** with a clean tree. Never upgrade on top of uncommitted work.
6. **Upgrade in stages**, one log entry at a time (and, within an entry, in the order of its *Required actions*). After each stage run the verification commands and commit. Stop and report if a stage cannot be made green; do not skip ahead.
7. **Apply the starter's own change, not a copy of its files.** For each stage, take the diff between the two starter tags and apply it with a three-way merge so project changes are preserved:
   ```bash
   cd /tmp/starter-upstream
   git diff v<from> v<to> -- . ':!package-lock.json' ':!skills' ':!.claude-plugin' > /tmp/starter-<from>-<to>.patch
   cd <project> && git apply --3way /tmp/starter-<from>-<to>.patch   # resolve conflicts by hand
   ```
   Then regenerate the lockfile with the project's package manager.
8. **Respect ownership** (table below). Starter-owned files can be taken as-is unless the project customised them; project-owned files must only be merged.
9. **Finish:** set `starter.version` in `package.json` to the target version, run the full verification, summarise what changed and any manual follow-ups (secrets to set, remote migrations to run).

### File ownership

| Kind | Files | Rule |
|---|---|---|
| Starter-owned | `bin/`, `src/cli/`, `src/shared/app-version.ts`, `src/shared/build-globals.d.ts`, `src/worker/adapters/`, `src/worker/middleware/`, `src/worker/utils/`, `src/worker/db/index.ts`, `src/worker/db/d1-dialect.ts`, `src/worker/db/backup.ts`, `src/worker/db/migrations/{migrate,columns,types}.ts`, `test/support/`, `src/react-app/components/ui/`, `vitest.config.ts`, `playwright.config.ts`, `.github/workflows/ci.yml`, `docs/` | Take upstream changes; re-apply local edits if any |
| Shared (merge carefully) | `src/worker/db/migrations/{baseline,index}.ts`, `src/worker/db/migrations/incremental/`, `src/worker/db/seeds/`, `package.json`, `vite.config.ts`, `wrangler.toml`, `src/worker/index.ts`, `src/react-app/App.tsx`, `src/worker/types/*`, `AGENTS.md`, `README.md` | Three-way merge, never overwrite |
| Project-owned | `src/config.ts` values, `env/*.template` values, `.env.*`, `migrations/` already applied, `seeds/`, all project pages/routes/components | Never overwrite; only add what a log entry requires |

### Rules for database migrations

- **Never edit or rename a migration that has been applied anywhere.** Upgrade by *adding* the starter's new migration files.
- If the project already has its own migration with the same number, give the *new* starter migration the next free number, and keep its `legacyName`/squash mapping consistent in `baseline.ts`.
- Apply new migrations to every environment (`db:migrate:preview:safe`, then `db:migrate:production:safe`) right after deploying code that needs them; write migrations additively so the previous code keeps working in between.

### Standard verification (run after every stage)

```bash
npm install            # or pnpm install
npm run lint && npx tsc -b
npm test               # from 2.0.0 on
npm run build
npm run db:migrate     # local
npm run test:e2e       # from 2.0.0 on, optional
```

---

## 3.3.0 — 2026-10-24

Node 24 LTS, a generic `wrangler.toml` environment merge, and removal of decorative scaffolding. **No schema change.**

### Breaking changes

1. **Node.js 24.22.1 or later** (`.nvmrc` `24.22.1`, `engines.node: ">=24.22.1"`, `@types/node` `^24`). 24.22.1 is the current LTS and the first release on that line with the October 2026 security fixes (patched lines: 22.23.4 / 24.22.1 / 26.12.1). The previous requirement was Node 26, which is not an LTS line.
2. **`vite.config.ts` merges `[env.*]` generically.** The hand-written per-key parsers are gone, replaced by a real TOML parse (`smol-toml`, new devDependency) that copies **every** key under `[env.preview]` / `[env.production]` onto the generated flat config. Adding a binding to `wrangler.toml` no longer requires mirroring it in `vite.config.ts`. A build-time `[wrangler-env]` warning fires when a non-inheritable key is set only at the top level.
3. **The `ExampleCounter` Durable Object is removed**, with its route (`/api/counter`), binding `EXAMPLE_COUNTER`, the `[[durable_objects.bindings]]` and `[[migrations]]` blocks in `wrangler.toml`, and its test. The starter now ships no Durable Object.
4. **The `KV_RATE` scaffolding is removed.** It was parsed by `vite.config.ts` but never declared in `wrangler.toml` nor used anywhere in `src/`.
5. **New `deploy.config.ts`** at the repository root (committed), holding the deploy mode, deployment branches, maintenance mechanism and failure-report address. `tsconfig.cli.json` includes it.
6. **New `npm run maintenance`** (`bin/maintenance.ts`): zone-level maintenance mode, `redirect` (any zone plan) or `snippet` (Pro or above). Defaults to `none`, so nothing changes until you configure it.
7. **`bin/deploy-production` is now `bin/deploy-production.ts`** (TypeScript, run through `tsx`). Delete the old executable. Same options plus `--local`.
8. **Migrations declare `compatibility`** — `expand` (default), `contract` (requires `safeSince`) or `breaking` — and that decides when they run: expand before the deploy, contract after it, breaking inside a maintenance window. Existing migrations need no change; they default to `expand`, which is what they already were.
9. **`npm run deploy:preview` is now `bin/deploy-pipeline.ts`**, the same sequence CI runs. New `npm run deploy:ci` for CI (adds `--skip-build`).
10. **Production deploys require a tag.** In `workers-builds` / `external-ci` mode a push to the deployment branch with no `vX.Y.Z` tag deploys nothing.
11. **New `migration_journal` table**, created automatically as bookkeeping (not a migration), plus `npm run db -- journal`. New CLI endpoints `/api/cli/migrations/pending`, `/api/cli/migrations/journal`, `/api/cli/schema`, `/api/cli/deploy-report`.
12. **`config.email.deployReportsTo`** in `src/config.ts`: where a failed deploy reports itself. Empty disables it.
13. **New `login_events` table and a cron that prunes it.** Migration `0004_login_events` (additive). `POST /api/auth/sign-in/*` now records every attempt, successful or failed, with IP, user agent and country. New `npm run db -- logins`, new CLI endpoint `/api/cli/login-events`, new `[env.*.triggers] crons` in `wrangler.toml` and a `scheduled` handler in `src/worker/scheduled.ts`. Retention is `AUTH_LOG_RETENTION_DAYS` (default 90) — IPs are personal data.
14. **The Worker entry is now an object, not the Hono app.** `export default { fetch, scheduled }`; the app is also exported as the named `app` for tests. Anything doing `import app from "./worker"` and calling `app.request()` must switch to `import { app }`.
15. **New `MAINTENANCE` Worker var** (`src/worker/middleware/maintenance.ts`): takes the app out of service in place, with a 503 shaped by the `Accept` header. The deploy sets it around a `breaking` migration; `/api/` and `/api/cli/*` stay reachable.
16. **New client interceptor** (`src/react-app/lib/maintenance.ts` + `components/MaintenanceOverlay.tsx`, installed in `main.tsx`): patches global `fetch`, holds same-origin requests caught by either maintenance mechanism — the var's 503, or the zone redirect, which reaches `fetch` as a network error — and replays them once the app returns. Concurrent calls share one polling loop. It polls the new **`GET /api/ping`**, which must stay subject to maintenance: `/api/` is exempt, so it cannot tell a recovery from a window.
17. **The `snippet` maintenance mechanism is removed.** `maintenance.mechanism` is now `redirect` or `none`. Snippets need a Pro zone and the `MAINTENANCE` var covers the planned case better; the zone redirect remains the emergency tool.
18. **New `docs/MECHANISMS.md`**: what the starter provides and why, so the README can stay an introduction.
19. **Fixed:** `getApiBaseUrl` now loads `.env.<environment>` itself. Callers that had not gone through `connectToDatabase` first silently used the placeholder URL from `src/config.ts`.

### Required actions

- Switch to Node 24.22.1 (`nvm install 24.22.1`), update `.nvmrc`, `engines`, and any Dockerfile/CI Node version. Reinstall dependencies.
- Take the starter-owned change in `docs/`; merge `vite.config.ts`, `package.json` (`engines`, `@types/node`, new `smol-toml` devDependency), `AGENTS.md`, `README.md`.
- **If you use Durable Objects, keep yours.** Only remove `ExampleCounter` if you never renamed it. Removing a deployed DO class needs a new `[[migrations]]` tag with `deleted_classes`; dropping the block outright is only safe before the first deploy.
- **If you declare DO bindings at the top level only**, move them under each `[env.*]`: the new warning will tell you. They worked before by inheritance from the flat config, which is not how `wrangler` itself behaves.
- Optional, to use maintenance mode: set `maintenance.mechanism`, `zoneId` and `redirectTo` in `deploy.config.ts`, and issue an API token with **zone** rule permissions (the Workers-scoped token from `bin/init` is not enough).
- Take the starter-owned changes in `bin/` (new: `deploy-pipeline.ts`, `deploy-production.ts`, `maintenance.ts`, `lib/deploy-config.ts`; deleted: `deploy-production`), `src/worker/db/migrations/`, `src/worker/db/schema-snapshot.ts`, `src/shared/migration-types.ts`, `src/cli/utils/db.ts`; merge `package.json` scripts, `src/config.ts`, `src/worker/routes/cli.ts`, `tsconfig.cli.json`.
- Set `deployConfig.mode`. It defaults to `manual`, which behaves like 3.2.0 except for the migration ordering.
- Read the expand/contract section of `docs/DEPLOYMENT.md` before writing the next migration that drops anything.
- If you already have a `scheduled` handler or cron triggers, merge rather than replace them; if you do not want the sign-in log, drop the migration, the handler and the `[env.*.triggers]` blocks together.
- Mention the sign-in log in your privacy notice: it stores IP addresses.
- Verify: `npx tsc -b`, `npm run lint`, `npm test`, `npm run build:production`, then check `dist/<name>/wrangler.json` has your production `name`, `vars` and bindings. `npm run maintenance -- status --env production` should report the configured mechanism.

---

## 3.2.0 — 2026-10-23

Versioned releases, build-variable sync for Cloudflare Workers Builds, and **database migrations on every deploy**. **No schema change.** The deploy commands behave differently, so read the breaking changes.

### Breaking changes

1. **`npm run deploy:production` is now `bin/deploy-production`.** It must run from a clean `main` that equals `origin/main`, bumps `package.json` (patch by default; `--minor`, `--major`, `--version vX.Y.Z`), commits `Release vX.Y.Z`, deploys, then pushes `main` and an annotated `vX.Y.Z` tag. `--dry-run` shows the plan; `--release-only` only bumps/tags/pushes. **Never run it without the owner's approval.** `npm run release:production` is the `--release-only` shortcut.
2. **Migrations run on every deploy** (`deploy:preview`, `deploy:production`), after `wrangler deploy`, through the deployed Worker (`db migrate --safe --wait-for-deploy`). The new code is therefore live before the schema changes: write migrations additive and backward-compatible. A migration failure makes the deploy command exit non-zero with the new code still live.
3. **`db migrate` is idempotent:** it lists pending migrations first and does nothing (no backup, no write) when none are pending. `--safe` now also prints the D1 Time Travel bookmark on remote D1, and skips the backup file in CI (ephemeral disk). New flag `--wait-for-deploy`.
4. **New build-time constants** `__APP_VERSION__` / `__APP_COMMIT__` (Vite `define`), exposed as `APP_VERSION` / `APP_COMMIT` from `src/shared/app-version.ts`, and as `version` / `commit` in `GET /api/`. `tsconfig.app.json` and `tsconfig.worker.json` now include `src/shared`; `tsconfig.node.json` includes `bin/lib/build-info.ts`.
5. `bin/sync-secrets.ts` no longer syncs `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` to the Worker.
6. The loose `deploy` script (`wrangler deploy`) is removed: it deployed whatever was in `dist/` with no environment, secrets, version or migrations. Use `deploy:preview` / `deploy:production`. Remove it from your `package.json` too if you merged this release.

### Required actions

- Take the starter-owned changes in `bin/` (new: `deploy-production`, `sync-build-vars.ts`, `lib/build-info.ts`), `src/cli/utils/db.ts`, `src/shared/`, `docs/` (new: `DEPLOYMENT.md`); merge `package.json` (scripts `deploy:preview`, `deploy:production`, `release:production`, `sync-build-vars`), `vite.config.ts` (the `resolveBuildInfo` import and the `define` block), `src/worker/index.ts` (`/api/` returns `version` and `commit`), `tsconfig*.json`, `AGENTS.md`.
- Make sure `bin/deploy-production` is executable (`chmod +x`).
- Set a real, additive-only migration discipline (see `docs/DEPLOYMENT.md`).
- Optional, for Workers Builds: create a user API token (*Workers Builds Configuration: Edit*, *Workers Scripts: Read*), put `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in `.env.setup.local`, and follow `docs/DEPLOYMENT.md`.
- Existing git tags `vX.Y.Z` unrelated to `package.json` `version` make the first run refuse (the version must match the tag on `HEAD`, and the next version is derived from the latest tag): align `package.json` or the tags first.
- Verify: `npx tsc -b`, `npm test`, `npm run build`, `bin/deploy-production --dry-run`, `npm run sync-build-vars -- production --dry-run`.

---

## 3.1.0 — 2026-10-19

Whole-database backup and restore on every supported database, a MySQL foreign-key fix, and a dependency audit. **No schema change on D1/SQLite/PostgreSQL.** Small required actions below.

### Breaking changes

1. **`db:backup`, `db:restore` and `migrate --safe` are database-agnostic.** They go through the Worker (`GET /api/cli/backup/*`, `POST /api/cli/restore/*`, protected by `CLI_API_KEY`) instead of `wrangler d1 export/execute`, so the dev server must be running for `local`, and the Worker must be deployed (with the new routes) for remote environments.
2. **New backup format:** `*.backup.jsonl` (JSON Lines: header with the applied migrations, rows per table in dependency order, end record with counts). It covers **every table** (auth and your own). Old `.sql` backups are not read by `db:restore`; restore them manually with `wrangler d1 execute <db> --file <backup>.sql [--remote]`.
3. **Restore rules:** the target must be at the same migration level as the backup (a fresh, unmigrated database is migrated first); contents are replaced table by table, **not atomically**, so a safety backup of the current data is taken first. New flags: `--yes` (required for remote environments in non-interactive shells), `--no-safety-backup`. Restoring across database kinds (for example D1 to PostgreSQL) is best-effort.
4. **MySQL foreign keys:** `0001_initial` and the baseline declared `accounts.userId` and `sessions.userId` as inline `references`, which MySQL silently ignores, so MySQL installs from 3.0.0 have no foreign key and no cascade on those columns. They are now table constraints (`accounts_userId_fk`, `sessions_userId_fk`). D1 and PostgreSQL were unaffected.
5. `tsconfig.cli.json` is new and `tsc -b` now type-checks `bin/` and `src/cli/`. `package-lock.json` was refreshed with `npm audit fix` (0 vulnerabilities).

### Required actions

- Take the starter-owned changes in `bin/`, `src/cli/`, `src/worker/db/backup.ts`, `src/worker/routes/cli.ts`, `test/support/`, `tsconfig*.json`, `docs/`; merge `src/worker/db/migrations/{baseline,incremental/0001_initial}.ts`, `test/*.test.ts` and `package.json` carefully.
- **MySQL installs created with 3.0.0 only:** add the missing constraints once (remove orphan rows first if any):
  ```sql
  DELETE FROM accounts WHERE userId NOT IN (SELECT id FROM users);
  DELETE FROM sessions WHERE userId NOT IN (SELECT id FROM users);
  ALTER TABLE accounts ADD CONSTRAINT accounts_userId_fk FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE;
  ALTER TABLE sessions ADD CONSTRAINT sessions_userId_fk FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE;
  ```
  (Do not edit the applied migration for other installs: the schema-drift test compares baseline and incrementals, and both now carry the constraints for new databases.)
- Deploy the Worker **before** running `db:backup:<env>` against a remote environment.
- Verify: `npx tsc -b`, `npm test`, `npm run test:db`, then `npm run db:backup` and `npm run db:restore:latest` locally.

### Known limits

Restore is not atomic. Self-referencing and cyclic foreign keys are not ordered automatically. Backups of a database that is being written to may be inconsistent. Very large databases are better served by the provider's native backups. Windows is not supported.

---

## 3.0.1 — 2026-10-19

Documentation only. **No required actions.** `AGENTS.md`, `docs/DATABASES.md` and the skill now state that the portability rules (D1 has no transactions, MySQL has no `RETURNING`, ...) apply to **starter-owned** database code only; project code may use anything its chosen database supports. Take the doc changes if you want them, then set `starter.version`.

---

## 3.0.0 — 2026-10-19

Database layer rewrite: **database-agnostic migrations, seeds, types and tests** (D1/SQLite, PostgreSQL, MySQL). You may upgrade **straight from 1.x or 2.x to 3.0.0**: skip the database stage of 2.0.0 (the SQL migration `0003`) and the whole 2.1.0 entry; this entry supersedes them. Apply the other 2.0.0 stages first if the project predates them.

### Breaking changes

1. **Migrations are TypeScript now**, in `src/worker/db/migrations/` (portable Kysely schema builder), run by the Kysely `Migrator` **inside the Worker** (`POST /api/cli/migrate`). The `migrations/*.sql` directory and `wrangler d1 migrations` are no longer used. New databases run one **baseline**; existing ones run **incremental** migrations. State lives in `kysely_migration`.
2. **Existing D1 databases are adopted automatically**: if the legacy `d1_migrations` table exists, each migration whose `legacyName` is listed there is marked applied. The legacy table is left untouched. The runner **refuses to proceed** if the legacy table matches no known migration (add `legacyName`s, see below).
3. **Project-owned SQL migrations must be converted** (see stage 2). Anything the project added under `migrations/` (new tables, columns) has to become a TypeScript incremental migration *and* be mirrored in `baseline.ts`.
4. `src/worker/db.ts` became the folder `src/worker/db/` (imports of `../db` still resolve). New exports: `databaseKind`, `dbNow()`, `dbBool()`, `toIso()`, `ignoreConflict()`. `databaseKind` feeds Better Auth (`type`) and the migration column types.
5. **Starter-owned database code is portable** (`docs/DATABASES.md`); project code is **not** required to be. Only one thing is needed in project code: writes to the auth tables (`users`, `accounts`, ...) must produce values that match the column types (see the stage 1 note); new databases now have real datetime/boolean columns.
6. **Types:** `createdAt`/`updatedAt`/`expiresAt` are `Timestamp` (`Date | string`), `emailVerified` is `DbBoolean`, `role`/`emailVerified` are `Generated`. The CLI API now returns ISO strings and boolean `emailVerified`. (Old D1 rows can hold epoch numbers written by the previous CLI and ISO strings written by Better Auth; `toIso()` handles both.)
7. **Seeds are TypeScript**, registered in `src/worker/db/seeds/index.ts` (`seeds/*.sql` and the `seeds/` directory are gone). `db:seed --file` takes a seed name.
8. **Tooling:** `db:migrate`, `db:migrations:list` and `db:seed` call the Worker (CLI_API_KEY). **Local development migrates automatically** on the first API request, so the Playwright `webServer` no longer runs `db:migrate`. (3.0.0 only: `db:backup`/`db:restore` stayed D1-only; they became database-agnostic in 3.1.0.)
9. **Tests:** Vitest has two projects (`worker`, `cross-db`); new devDependencies `mysql2`, `pg`, `@types/pg`, `@electric-sql/pglite`; new `docker-compose.test.yml`, scripts `test:db:up|down`, `test:db`; CI runs PostgreSQL and MySQL services. `test/apply-migrations.ts` now uses the runner (no `readD1Migrations`).

### Required actions (in this order)

**Stage 1 — Take the new database layer**
- Take `src/worker/db/**`, `src/worker/types/database.ts` (keep any project tables you added, in `Database`), `src/worker/routes/cli.ts`, `src/worker/middleware/auth.ts` (`type: databaseKind`), the auto-migrate middleware in `src/worker/index.ts`, `bin/db.ts`, `src/cli/utils/db.ts`, the new `package.json` scripts/devDependencies.
- In project code that writes to the auth tables, replace `Date.now()` timestamps with `dbNow()` and `emailVerified: 1/0` with `dbBool(...)` (or equivalents for your database). Project code on other tables needs no change. Reinstall; fix type fallout.

**Stage 2 — Convert project migrations and seeds**
- For every project-owned `migrations/NNNN_name.sql`: create `src/worker/db/migrations/incremental/NNNN_name.ts` (factory `(kind) => ({ legacyName: "NNNN_name", up })`, using the schema builder and `columnTypes(kind)`), register it in `migrations/index.ts`. Starter migrations already carry their `legacyName`s; **use the exact SQL file name without `.sql`** for yours (check `select name from d1_migrations`).
- Mirror every project table/column in `baseline.ts` and append the new migration names to its `squashes`.
- Convert `seeds/*.sql` to idempotent TypeScript seeds (`ignoreConflict`) and register them.
- Delete `migrations/` and `seeds/`. Run `npm test`: the drift test must pass (baseline == incrementals).

**Stage 3 — Existing databases**
- Back up (`db:backup:<env>`), deploy, then `npm run db:migrate:<env>:safe`. Check `npm run db:migrations:list:<env>`: every migration should show as applied and no error about unmatched legacy names. Do preview first, production last.

**Stage 4 — Tests and CI**
- Take `vitest.config.ts`, `test/`, `docker-compose.test.yml`, the CI changes, and the Playwright change. Run `npm run test:db:up && npm run test:db` once.

### Verify
Standard verification, plus `npm run test:db` (needs Docker), the local dev server starting on an empty checkout (auto-migrate), and `db:migrations:list` on each remote environment.

---

## 2.1.0 — 2026-10-19

Small release; one stage. Requires 2.0.0 first.

### Breaking changes

1. **Database connections are created in one place:** new `src/worker/db.ts` exports `createDb(env)`. `src/worker/utils/db.ts` (`requireDb`) was removed. Any project route that imported `requireDb` or builds `new Kysely({ dialect: new D1Dialect(...) })` inline keeps working only if it is updated.
2. `src/worker/types/database.ts`: the auth tables are now `AuthDatabase`; `Database extends AuthDatabase` is where project tables go. Code importing `Database` is unaffected.

### Required actions
- Take `src/worker/db.ts`; replace `requireDb(c)` / inline Kysely construction in project routes with `createDb(c.env)`; remove the now-unused `kysely`/`kysely-d1` imports there.
- In `database.ts`, rename the existing auth interface to `AuthDatabase` and add `export interface Database extends AuthDatabase {}`; move any project tables you added into `Database` (or an interface it extends).
- Optional: read `docs/DATABASES.md` if the project uses, or plans to use, another database or a provider API.

### Verify
Standard verification.

---

## 2.0.0 — 2026-10-19

First versioned release. Baseline for this entry is the unversioned `main` as of 2026-07-03 (commit `5d89c05`, tag `v1.0.0`). Large release; **upgrade in the stages below**.

### Breaking changes

1. **Node.js 26 required** (`.nvmrc`, `engines.node: ">=26 <27"`, `engine-strict`). CI uses `.nvmrc`.
2. **`BETTER_AUTH_SECRET` is now required in preview and production.** Auth throws without it. Previously Better Auth could silently use a public default secret. **Side effect:** changing the secret invalidates existing sessions and verification/reset tokens (users must sign in again).
3. **Database:** new migration `0003_account_token_columns.sql` (adds `accounts.idToken`, `accounts.refreshTokenExpiresAt`) required by Better Auth 1.7. Auth fails with "Database schema mismatch" until applied. `verifications` TS type now uses `value` (was `token`).
4. **Email was restructured into adapters.**
   - Binding renamed `SEND_EMAIL` → `EMAIL` (`wrangler.toml`, `vite.config.ts`, `AppEnv`). It uses the object API: `env.EMAIL.send({ from, to, subject, text, html })`.
   - Removed env vars `EMAIL_PROVIDER` and `EMAIL_API_KEY`. Provider is now `config.email.provider` in `src/config.ts` (replaces `config.email.defaultProvider`). **The built-in third-party provider from 1.0.0 (Resend) was removed**; the only shipped adapter is Cloudflare. Projects that used it must re-create it as a custom adapter (a complete example is in `docs/EMAIL.md`) and keep their API key secret (rename `EMAIL_API_KEY` to the adapter's own name).
   - `src/worker/utils/email.ts` removed; use `src/worker/adapters/email/`. The sender method was renamed `sendVerificationEmail` → `sendEmail`. The `resend` npm dependency was removed.
   - `vite.config.ts` injects the `send_email` binding only if `wrangler.toml` declares it.
5. **API routes were split out of `src/worker/index.ts`** into `src/worker/routes/` (`cli.ts`, `profile.ts`, `example-counter.ts`) mounted with `app.route()`. Projects that added handlers to `index.ts` should move them to their own `routes/*.ts` file.
6. **Base URL fallbacks moved** from `getBaseURL()` in `middleware/auth.ts` to `config.baseUrls` in `src/config.ts` (`npm run init` updates them). Projects that edited `getBaseURL` must move their URLs to `config.baseUrls`.
7. **The `*` catch-all route now renders a public 404 page** (`pages/NotFound.tsx`) instead of the protected Home. Add explicit routes for any deep link that relied on the old fallback.
8. **Durable Object example added**: top-level `[[durable_objects.bindings]]` (`EXAMPLE_COUNTER`) and `[[migrations]]` tag `v1` in `wrangler.toml`, class `ExampleCounter` exported from the Worker entry. Projects with their own DO migrations must keep their own tag history (never reuse or edit a deployed tag); the example can be deleted (see `docs/VITE_CLOUDFLARE_BRIDGE.md`) as long as binding, migration entry and export are removed together *before first deploy*.
9. **`npm run cf-typegen` now runs `wrangler types --env-file .env.example`** so `worker-configuration.d.ts` no longer embeds a developer's local `.env.local` keys. Regenerate that file after upgrading.
10. **Dependencies**: all bumped to current majors (React 19.2, Vite 8.2, Vitest 5, Better Auth 1.7, Zod 4, TypeScript 6, ESLint 10, Tailwind 4). Removed: `resend`, `@tanstack/react-table`, `@opentelemetry/api`. Added (dev): `vitest`, `@cloudflare/vitest-plugin`, `@playwright/test`.

### Required actions (in this order)

**Stage 1 — Runtime and dependencies**
- Switch to Node 26 (`nvm install 26`), update `.nvmrc`, `engines`, any Dockerfile/CI Node version.
- Merge the starter's `package.json` dependency changes, reinstall, fix type/lint fallout. Verify.

**Stage 2 — Database**
- Add `migrations/0003_account_token_columns.sql` (renumber if taken), update `src/worker/types/database.ts` (`accounts.idToken`, `accounts.refreshTokenExpiresAt`, `verifications.value`).
- `db:migrate` locally, then preview, then production, before deploying Stage 3+ code. Verify sign-up/sign-in locally.

**Stage 3 — Auth secret**
- Generate a distinct value per environment (`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`) and set `BETTER_AUTH_SECRET` in `.env.preview` and `.env.production` (and optionally `.env.local`). Take the `secret` / guard change in `middleware/auth.ts`, the `sync-secrets` check, and the env templates.
- Warn the user that sessions will be reset on first deploy.

**Stage 4 — Email adapters**
- Take `src/worker/adapters/email/`, `utils/html-to-text.ts`, the `auth.ts` import change, `config.email.provider`, `AppEnv` changes.
- `wrangler.toml` (all three `[[send_email]]` blocks): `name = "EMAIL"`. Remove `EMAIL_PROVIDER` from `[vars]`. Delete `EMAIL_PROVIDER`/`EMAIL_API_KEY` from `.env.*` files; if the project used the old third-party provider, create a custom adapter from the `docs/EMAIL.md` example and set `config.email.provider` to it.
- Any custom code calling `sendVerificationEmail` or `createEmailSender(env)` must use `sendEmail`.

**Stage 5 — Structure, tests, CI**
- Move custom handlers out of `index.ts` into `routes/`; mount with `app.route()`. Adopt `config.baseUrls`.
- Add `vitest.config.ts`, `test/`, `playwright.config.ts`, `e2e/`, the `test`/`test:e2e` scripts, the CI jobs, `.gitignore` entries. Replace/rename the example DO as needed. Run `npm run cf-typegen`.
- Adopt the 404 route in `App.tsx`.

### Verify
Standard verification, plus: sign-up works locally; `npx wrangler deploy --dry-run` lists the `EMAIL` binding (Cloudflare provider) and your D1 database; `npm run db:migrations:list:production` shows no pending migration after migrating.

---

## Unversioned installs (before 1.0.0)

Projects created before this log have no `starter.version`. Identify the closest baseline by signature, then read the starter's git history from that point (`git log --oneline <commit>..v1.0.0`) and apply stages in order. Each row is a **breaking milestone** in the starter's history:

| Signature in the project | Milestone commit | What it changed |
|---|---|---|
| No `src/config.ts`, no auth | `1983da3` (2025-12-09) | Auth, D1, CLI and app shell introduced |
| No `bin/db.ts`, `db:*` scripts missing | `972ee2d` (2026-04-23) | Database lifecycle CLI (migrate/backup/restore/seed) |
| Auth CLI logs in with admin email/password (`CLI_ADMIN_*`) | `ca39e43` (2026-04-23) | CLI now authenticates with shared `CLI_API_KEY` (set it in the Worker **and** `.env.*`) |
| `users` table without `role` | `67cb34e` (2026-04-23) | Role management; migration `0002_add_role.sql` |
| No `EMAIL_PROVIDER` | `d880748` (2026-04-26) | Multiple email providers, Cloudflare `send_email` binding |
| Deploys use `wrangler deploy --env` | `ba6ae19` (2026-05-13) | Flat `wrangler.json` model: per-env values baked by `vite.config.ts`; D1 naming convention; `docs/VITE_CLOUDFLARE_BRIDGE.md` |
| `vite` < 8 | `c72c970` (2026-06-14) | Vite 8 |
| `typescript` < 6, `react-router-dom` < 7, `zod` < 4 | `10dddcb`, `6b25a06` (2026-06-14) | TS 6, React Router 7, Zod 4, ESLint 10, SPA deep-link routing |
| `tailwind.config.*` present / `tailwindcss` < 4 | `9b86948` (2026-07-03) | Tailwind CSS v4 migration (PostCSS plugin, CSS-first config, shadcn classes) |
| Node < 22.15 | `86b583e` (2026-07-03) | Node ≥ 22.15 required |

Everything from `5d89c05` (2026-07-03) onward is covered by the 2.0.0 entry. For a milestone, inspect the exact change with `git show <commit> --stat` and `git diff <commit>^ <commit>` in the upstream clone, apply it with `--3way`, verify, commit, then continue to the next.

---

## Maintainer checklist (for each release)

1. Add an entry at the top of this log **if anything can break an existing install** (config keys, env vars, bindings, schema, scripts, runtime versions, file moves, behavior changes). List *Breaking changes* and ordered *Required actions*; split large releases into stages.
2. Bump `starter.version` in `package.json` (semver: major = breaking, minor = backwards-compatible features, patch = fixes).
3. Tag the release `vX.Y.Z` (the upgrade procedure diffs between tags) and push tags.
4. If a release is too large to apply in one go, say so and define the stages.
