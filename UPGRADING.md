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
| Starter-owned | `bin/`, `src/cli/`, `src/worker/adapters/`, `src/worker/middleware/`, `src/worker/utils/`, `src/react-app/components/ui/`, `vitest.config.ts`, `playwright.config.ts`, `.github/workflows/ci.yml`, `docs/` | Take upstream changes; re-apply local edits if any |
| Shared (merge carefully) | `package.json`, `vite.config.ts`, `wrangler.toml`, `src/worker/index.ts`, `src/react-app/App.tsx`, `src/worker/types/*`, `AGENTS.md`, `README.md` | Three-way merge, never overwrite |
| Project-owned | `src/config.ts` values, `env/*.template` values, `.env.*`, `migrations/` already applied, `seeds/`, all project pages/routes/components | Never overwrite; only add what a log entry requires |

### Rules for database migrations

- **Never edit or renumber a migration that has been applied anywhere.** Upgrade by *adding* the starter's new migration files.
- If the project already has its own migration with the same number, rename the *new* starter migration to the next free number (keep the SQL).
- Apply new migrations to every environment (`db:migrate`, then `db:migrate:preview:safe`, `db:migrate:production:safe`) **before** deploying code that needs them.

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
