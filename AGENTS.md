# AI Agent Development Guide

> Essential instructions for AI coding agents working on this project.
> For initial setup, see `docs/AGENTS_SETUP.md`.

## Project Overview

The project is based on a SaaS starter template built on Cloudflare's edge platform with:
- **Frontend**: React 19 + TypeScript + Vite + Tailwind CSS + shadcn/ui
- **Backend**: Hono on Cloudflare Workers
- **Database**: Cloudflare D1 (SQLite at the edge)
- **Auth**: Better Auth (email/password with verification)
- **Email**: pluggable adapter; Cloudflare Email Service by default (`send_email` binding)
- **Tests**: Vitest (`@cloudflare/vitest-plugin`) for the Worker + D1; Playwright for a smoke E2E

## Critical Architecture

### Vite + Hono Integration
The `@cloudflare/vite-plugin` unifies frontend and backend in one dev server:
- Single server at http://localhost:5173
- API routes at `/api/*` handled by Hono
- Hot reload works for both frontend and backend
- One server for both: a separate frontend server or a proxy to the Worker is not needed

### API-Only Database Access
Frontend code reaches the database through the API only; Kysely and D1 live in the Worker:
```typescript
// ✅ Correct - use API
const response = await fetch('/api/users');

// ❌ Wrong - direct database access
import { Kysely } from 'kysely';
```

## File Structure

```
src/
├── react-app/              # React frontend
│   ├── assets/             # Static assets (logos, images)
│   │   ├── logo-light.svg  # Logo for light theme
│   │   └── logo-dark.svg   # Logo for dark theme
│   ├── components/
│   │   ├── auth/           # Auth UI (LoginForm, ProtectedRoute, AuthOverlay)
│   │   ├── ui/             # shadcn/ui components
│   │   ├── TopBar.tsx      # Full-width header with logo and user menu
│   │   ├── Logo.tsx        # Theme-aware logo component
│   │   ├── ModeToggle.tsx  # Dark/light theme toggle
│   │   └── theme-provider.tsx  # Theme context with URL param support
│   ├── admin/              # Example admin area at /admin (layout, nav config, pages) — see docs/ADMIN.md
│   ├── pages/              # Route pages
│   │   ├── auth/           # SignUp, VerifyEmail, ForgotPassword, ResetPassword
│   │   ├── Home.tsx        # Protected home
│   │   └── Profile.tsx     # User settings
│   └── lib/
│       └── auth/client.ts  # Better Auth React client
└── worker/                 # Hono backend
    ├── index.ts            # Mounts routes with app.route(); exports Durable Objects (none by default)
    ├── routes/             # One file per feature (cli.ts, profile.ts, ...)
    ├── db/                 # createDb(), databaseKind, portable migrations (baseline + incremental), seeds
    ├── middleware/auth.ts  # Better Auth config
    ├── types/database.ts   # Kysely types (AuthDatabase + your tables)
    ├── adapters/           # Swappable service adapters (email)
    └── utils/              # Email templates and helpers

src/cli/                    # CLI commands (auth user management + db utilities)
src/config.ts               # Global app configuration (app name, etc.)
bin/                        # CLI entry points (init, auth, db) and worktree scripts
test/                       # Vitest worker integration tests (D1 migrations applied)
e2e/                        # Playwright smoke tests
```

## Key Patterns

### Protected Routes
Wrap routes with `<ProtectedRoute>` to require authentication:
```tsx
<Route path="/dashboard" element={
  <ProtectedRoute>
    <Dashboard />
  </ProtectedRoute>
} />
```

### Roles
Roles are in `src/shared/roles.ts` (`user` < `admin` < `superadmin`); `session.user.role` carries the role. Check with `hasRole(role, "admin")` (admin or higher) and protect API routes with `requireRole("admin")` (`src/worker/middleware/roles.ts`) after `authMiddleware`. A role check in the browser only decides what is shown; the Worker must check it too.

<!-- [admin-area] -->
### The admin area
`/admin` is an example backoffice (admins and up, 403 otherwise) that a project may restyle or remove. To add a page there see `docs/ADMIN.md`; `npm run admin:remove` removes the whole area.
When working on the area, keep it removable: put a helper only it uses in `src/react-app/lib/admin-util.ts` (deleted with it) rather than a new file under `lib/`, and mark whatever it adds to a shared file with the markers described in `docs/ADMIN.md`, *Removing it*.
**Lists in the admin area use `AdminTable`** (`src/react-app/admin/components/AdminTable.tsx`, guide in `docs/ADMIN_TABLE.md`): it brings the toolbar, search, sorting, row numbers, selection, bulk and row actions, pages and the loading and empty states, so every list looks and behaves the same. Configure it through its props (columns, `cell` renderers, `rowActions`, `bulkActions`, `deletable`, `intro`, `empty`, `state`) rather than building a table from `components/ui/table`; reach for something else only when a list genuinely does not fit it (then say why in a comment). The app's own pages, outside `/admin`, are not bound by it: their design is the app's.
<!-- [/admin-area] -->

### Adding API Endpoints
Create one module per feature in `src/worker/routes/` and mount it in `src/worker/index.ts` with `app.route()`. Don't grow `index.ts` with handlers:
```typescript
// src/worker/routes/items.ts
export const items = new Hono<AppBindings>();
items.use("*", authMiddleware);          // protected; omit for public routes
items.get("/", async (c) => {
  const user = c.get("user");
  // ...
});

// src/worker/index.ts
app.route("/api/items", items);
```

### Errors (both sides)
Return errors through `AppError` / `fail()` (`src/worker/lib/errors.ts`): a message written for the user, and the real cause in `log`, which is only logged:
```typescript
if (!post) return fail(c, 404, "That post no longer exists.", { log: `post ${id} not found`, code: "post_not_found" });
throw new AppError(403, "You can't edit someone else's post.", { log: `user ${user.id} → post ${id}` });
```
In the browser, call the API with `http()` (`import { http } from "@/lib/http"`) rather than bare `fetch`, which skips the error handling. The HTTP layer (`src/react-app/lib/http/`) shows every failure of a managed call and then makes it **reject** with `HandledHttpError`. So call sites do not check `res.ok` or show error messages; code after `await http()` runs only on success. A call that handles a status itself lists it: `http(url, { handles: [404] })`; `[0]` takes network failures, `"all"` everything. A `catch` that exists to undo local state must not show `HandledHttpError` again (`isHandledHttpError()`). Error responses are handled only for calls with a `handles` key other than `null` (which `http()` adds): a plain `fetch`, or `handles: null`, gets its statuses untouched. Lost connections and maintenance are ridden out for **every** same-origin request, aware or not: held, and sent again in order, writes included, with a stable `Idempotency-Key` — an endpoint where a duplicate would do harm should deduplicate on it. A library with its own offline strategy goes in `installHttpLayer({ exclude })`. For offline support, register `http.addOfflineHandler()` (answer from local data) and `http.beforeReconnect()` (send an outbox); read `http.online` / `http.state`, or listen to `app:online` / `app:offline`, rather than `navigator.onLine`. While requests are held the layer blocks the page (`inert` on everything outside `#http-layer`); a page of your own that is fixed to the viewport should offset by `--app-banner-h`. See `docs/MECHANISMS.md`, *The HTTP layer* and *Lost connection*.

### Localisation (i18n)
User-facing strings of the starter's own UI — the HTTP layer's dialogs, banners and toasts among them — live in `src/react-app/lib/i18n.ts` and are read through `t(key, params)`. Add new ones there under a stable key with an English default. No i18n library is imposed: an app plugs its own in with `setTranslator()`, or changes a few words with `overrideMessages()`; a missing translation falls back to the default. Server messages are looked up as `error.<code>` first, so the server keeps writing English and the client translates by code. See `docs/MECHANISMS.md`, *Localising*.

### Demo mode
`DEMO_MODE` (a Worker secret, never committed) makes a deployment read-only: `src/worker/middleware/demo.ts` refuses every `/api/*` write except sign-in/out, client error reports and the CLI, and the email adapter sends nothing. A new write route needs nothing to be covered; a write that must stay possible in a demo goes in `ALLOWED_WRITES`. See `docs/MECHANISMS.md`, *Demo mode*.

### UI components (shadcn/ui)
Installed components are in `@/components/ui/`; `docs/SHADCN_COMPONENTS.md` lists the whole catalogue, with the install command for the rest. When building something the catalogue has, use its component (installing it if needed) rather than writing an equivalent; use another library or a custom component when nothing in it fits.

To change a component, from lightest to heaviest: theme variables in `src/react-app/index.css`; a small adjustment (a variant, a size, a default class) in place, marked `// project:`; anything more as a new component outside `components/ui/`, composed from catalogue components or copied from one. Rather than rewriting an official component in place, give the reworked one its own name.

### Dependencies
Each package adds weight, attack surface and update work. Before adding, swapping or reintroducing one, read `docs/DEPENDENCIES.md` (why each is here, what was dropped and why), and record the decision under its *Project choices*.

### Database Queries (Backend Only)
Get the connection from the single factory in `src/worker/db`, rather than constructing Kysely in a route:
```typescript
import { createDb } from "../db";

const db = createDb(c.env);
const users = await db.selectFrom("users").selectAll().execute();
```
**Portability scope:** starter-owned database code (the auth tables, the CLI routes, migrations 0001-0003, seed helpers) is kept portable across D1/SQLite, PostgreSQL and MySQL so every supported database works out of the box; keep it that way when you edit those files (helpers: `dbNow()`, `dbBool()`, `toIso()`, `ignoreConflict()`, `dbSecondsBetween()`, `columnTypes()`). **Your own code is not restricted:** once the project has chosen its database, use whatever that database supports (transactions on PostgreSQL/MySQL, `RETURNING`, native types, raw SQL). Differences worth knowing, other databases and provider APIs: `docs/DATABASES.md`.

## Commands

> For remote database/auth commands, `.env.<env>` is loaded automatically — no manual `source` needed.

```bash
# Development
npm run dev                         # Start dev server (logs appear in terminal)
npm test                            # Vitest worker integration tests
npm run test:e2e                    # Playwright smoke test (starts the dev server)

# Database — migrations
npm run db:migrate                  # Run migrations locally
npm run db:migrate:preview:safe     # Migrate preview with pre-migration backup
npm run db:migrate:production:safe  # Migrate production with pre-migration backup

# Database — migration status
npm run db:migrations:list
npm run db:migrations:list:preview
npm run db:migrations:list:production

# Database — backup & restore
npm run db:backup        # Back up the whole local database (any supported DB) to .wrangler/backups/*.backup.jsonl
npm run db:backup:production   # Same for production
npm run db:restore:latest        # Restore latest backup (takes a safety backup of the current data first)
npm run db:restore -- --env production --file prod.backup.jsonl --yes

# Database — time-travel (remote envs only)
npm run db:time-travel:info -- --env production
npm run db:time-travel:restore -- --env production --timestamp "2026-04-01 12:00:00"

# Database — seeds
npm run db:seed -- --env local --file admin-bootstrap

# Auth CLI
# Requires CLI_API_KEY in .env.<env>; key must also be deployed to the worker
# dev server must be running for local
# Available user management commands (run `npm run auth help <command>` to see options):
npm run auth list-users
npm run auth create-user
npm run auth edit-user
npm run auth delete-user
npm run auth activate-user        # email verified on/off (alias verify-user)
npm run auth enable-user          # sign-in allowed on/off; off signs out everywhere
npm run auth sign-out-user
npm run auth set-role
npm run auth show-user            # with sign-in totals, time in session, live sessions
npm run auth user-activity        # a user's sign-in history

# Build & Deploy
npm run build                  # Build for production
npm run deploy:production      # Versioned release: secrets + build vars + build + deploy + tag + migrate (patch; --minor/--major)
npm run deploy:preview         # Same steps on preview, without versioning
npm run setup:ci               # Connect Cloudflare Workers Builds to GitHub (idempotent; --dry-run). Needs the user's approval: it deploys
npm run setup:domain -- <host> # Serve an environment on a custom domain (--env preview; --dry-run). Needs the user's approval: it changes the live URL
npm run sync-env -- <env>      # Send what changed in .env.<env> (secrets + build variables); before pushing to the preview branch

# Logs (deployed environments only)
npm run tail:preview           # Stream logs from preview
npm run tail:production        # Stream logs from production
```

## Working in a git worktree

> Applies only to an agent working in a git worktree, not in the main checkout.

A worktree needs its own dependencies, local settings and database, and its own dev server port. Two scripts in `bin/` do it:

| Step | Command | What it does |
|---|---|---|
| Set up (once) | `bin/worktree-setup` | Installs the dependencies (pnpm if the source checkout has a `pnpm-lock.yaml`, npm otherwise), copies the source checkout's `.env.local`, and takes a snapshot of its local D1 database (test users and content included) |
| Dev server | `bin/worktree-dev [port]` | Writes the port into `.env.local` (`APP_BASE_URL`, `CLI_API_URL`) and starts `npm run dev` on it; with no port, it picks a free one |
| Tear down | stop the dev server, then `git worktree remove <path>` | Nothing else: the database and settings live inside the worktree |

**Under Paseo**, `paseo.json` already does this: it runs `bin/worktree-setup` when it creates the worktree and offers `bin/worktree-dev` as the `dev` service, which it stops on archive. Start that service rather than `npm run dev`. **Without Paseo** — including a worktree Claude Code created (`claude --worktree`, a subagent with `isolation: worktree`), which it checks out but does not set up — run the commands above yourself: `bin/worktree-setup` once, then `bin/worktree-dev` in the background.

- **Open the app at the `APP_BASE_URL` in `.env.local`**, not at another hostname such as a proxy's: sign-in accepts only that origin.
- **E2E and the auth CLI** read the port from `.env.local`, so start the dev server first. Otherwise they would reach whatever server holds port 5173, which is usually the main checkout's. `npm test` does not depend on the port.
- **Use the package manager `bin/worktree-setup` installed with** (it says which): the other one would reinstall `node_modules` in its own layout.
- **The local database is a copy**: changes stay in the worktree and go with it. `bin/worktree-setup --fresh-db` copies it again.
- **Only local files are copied.** Without `.env.preview`, `.env.production` and `.env.setup.local`, a worktree cannot reach Cloudflare. Don't copy them in.
- **Don't** push to `main` (it deploys the preview), or run `deploy:*`, `sync-*`, `setup:ci` or remote `db:*` commands. Commit on the worktree's branch; merging is the user's call.

## Common Tasks

### Add a New Page
1. Create `src/react-app/pages/MyPage.tsx`
2. Add route in `src/react-app/App.tsx` wrapped with `<ProtectedRoute>` and `<TopBar>` if needed
3. Add navigation as appropriate for your app (TopBar doesn't include nav by default)

### Add an API Endpoint
1. Add a module in `src/worker/routes/` and mount it in `src/worker/index.ts` with `app.route()`
2. Use `authMiddleware` if authentication required
3. Get the database with `createDb(c.env)` (`src/worker/db`)

### Add Database Table
1. `npm run db -- new-migration <snake_case_name>` scaffolds the file and registers it in `migrations/index.ts`; mirror the change in `baseline.ts` (append the name to `squashes`)
2. Add types to `src/worker/types/database.ts`
3. `npm test` (a drift test checks baseline == incrementals on every database); local dev migrates automatically
4. For remote envs, prefer `npm run db:migrate:preview:safe` / `npm run db:migrate:production:safe` (takes a backup first)

### Sign-in log

`login_events` is a permanent history of every sign-in (failed ones too), sign-out, expired or revoked session and account deletion, with IP, user agent, country, method, duration and who caused it; `user_stats` keeps per-user totals (sign-ins, failures, time in session) that survive pruning. `sessions` cannot answer "who has used this app": it holds only sessions that still exist. Read it with `npm run db -- logins --env <env>` or `npm run auth user-activity -- -u <email>`.

IPs are personal data: your privacy notice has to mention them. Set `AUTH_LOG_RETENTION_DAYS` to have the cron in `src/worker/scheduled.ts` prune older rows; unset, nothing is deleted.

### Writing migrations

> The reasoning behind this and every other mechanism the starter provides is in
> [docs/MECHANISMS.md](docs/MECHANISMS.md). Read it before changing any of them.

Scaffold with `npm run db -- new-migration <snake_case_name>`: it also registers the migration in `migrations/index.ts`, which a hand-written file would miss.

Every migration declares **`compatibility`**, and that decides when the deploy runs it:

| Value | Use for | Runs |
|---|---|---|
| `expand` (default) | new tables, nullable columns, columns with a default, indexes | before the deploy; in a short maintenance window when the release brings it (only the new code can apply it) |
| `contract` | removing what an earlier release stopped using | after the deploy; **requires `safeSince`** |
| `breaking` | anything that cannot work with the running version | inside a maintenance window |

Rules, in order of how much damage breaking them does:

1. **Never drop or rename in the same release that stops using the thing.** The old code is still serving requests against the new schema. Split it: one release stops using the column, a *later* one drops it with `safeSince` set to the first.
2. **Never add a `NOT NULL` column without a default.** The running version does not know to write it. That is `breaking`, not `expand`.
3. **Keep every statement idempotent** — use `ensureColumn` / `ensureIndex` / `ensureTable` / `ensureNoColumn` from `src/worker/db/migrations/ensure.ts`. MySQL and SQLite do not roll back a failed migration, so re-running it is the normal recovery, and that only works if what already applied is skipped.
4. **Never edit a migration that has been applied anywhere.** Write a new one.

Full reasoning and the worked rename example: `docs/DEPLOYMENT.md`.

## Configuration

### App Configuration (`src/config.ts`)
Global settings shared by frontend and backend:
```typescript
import { config } from "../config";
// or from worker: import { config } from "../../config";

console.log(config.appName);  // "My App"
console.log(config.email.fromAddress);  // "noreply@example.com"
```

Update `src/config.ts` to customize app name, email settings, etc.

### Environment Variables

**Configuration hierarchy:**
1. `src/config.ts` — Global app config (app name, branding) - shared by frontend & backend
2. `wrangler.toml` — Non-secret environment config (D1 bindings, ENVIRONMENT var)
3. `.env.local` / `.env.preview` / `.env.production` — Secrets per environment (gitignored)

**How env files work:**
- `.env.local` — Loaded during local development (`npm run dev`)
- `.env.preview` / `.env.production` — Synced to Cloudflare before deploy (secrets to the Worker; `VITE_*` and `CLI_API_URL*` to Workers Builds as build variables). CI never reads them: it uses what was synced. `deploy:production` syncs in every mode; a CI deploy of preview started by a push needs `npm run sync-env -- preview` first

**Variable access by context:**
```typescript
// Client-side (React) - only VITE_ prefixed variables
const apiUrl = import.meta.env.VITE_API_URL;

// Server-side (Worker) - all variables from wrangler.toml + .env files
const baseUrl = c.env.APP_BASE_URL;
const environment = c.env.ENVIRONMENT;  // from wrangler.toml
```

**Deploying secrets:**
- `npm run deploy:preview` / `npm run deploy:production` automatically syncs secrets from `.env.<env>` files
- Only changed secrets are synced (tracked via hash file)

**Deploys, versions and migrations** (details: `docs/DEPLOYMENT.md`):
- Both deploy commands run pending DB migrations through the Worker, ordered by each migration's `compatibility` (see *Writing migrations*); a release that brings migrations deploys in a short maintenance window, because only the new code can apply them.
- The release version is `version` in `package.json` (git tag `vX.Y.Z` on `main`), exposed as `APP_VERSION` / `APP_COMMIT` (`src/shared/app-version.ts`) and in `GET /api/`.

**CLI auth (`CLI_API_KEY`):**
- The auth CLI authenticates to `/api/cli/*` using a shared `CLI_API_KEY` secret sent as `x-api-key`.
- Generate one per environment: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
- Set it in each `.env.<env>` file; the deploy scripts sync it to the Worker automatically.

## Platform Philosophy: Cloudflare-First, Not Cloudflare-Only

Prefer Cloudflare services (D1, Email Service, R2, KV, Durable Objects, ...) whenever one fits: cost, simplicity and latency are the reasons this starter exists. But don't impose them: if the user prefers another provider, or is converting a project that already uses one, support it.

Services that can reasonably be swapped sit behind an **adapter**: a small interface in `src/worker/adapters/<service>/types.ts`, one file per implementation, and a registry in `index.ts` that picks the implementation from `src/config.ts`. Feature code only imports the registry. Email is the reference example:

- Interface: `EmailSender.sendEmail({ to, subject, html, text? })`
- Implementations: `cloudflare.ts` (default); add others beside it
- Selection: `config.email.provider`; provider secrets live in `.env.<env>`

To add or replace a provider, follow `docs/EMAIL.md`.

**Data:** D1 is the default, but the schema, migrations, seeds, auth and tests are portable across D1/SQLite, PostgreSQL and MySQL (all tested). Connections come from `createDb()` in `src/worker/db`; for another SQL database, a second store, or a provider SDK (Supabase, Neon, ...), follow `docs/DATABASES.md`. Backup/restore work on every supported database (logical, through the Worker API); only time-travel is D1-specific. Prefer keeping auth on D1 and putting domain data elsewhere if a provider is wanted. When a user brings a new service need that has Cloudflare and non-Cloudflare options, introduce an adapter following the same pattern rather than hard-wiring either.

## Downstream Projects

`package.json` has a `starter` field (`starter.version`) recording which starter release the project is based on. Keep it, and update it only as part of an upgrade (see `UPGRADING.md`).

Projects built on this starter should edit few starter files so later upstream pulls stay cheap. Put project-specific values in `src/config.ts`, `wrangler.toml` vars/bindings and the `env/*.template` files, and add features as new files (routes, pages) rather than rewriting starter ones. `vite.config.ts` copies every key under `[env.*]` from `wrangler.toml` into the deploy config generically, so new bindings need no change there; see `docs/VITE_CLOUDFLARE_BRIDGE.md`. Scripts are package-manager agnostic (npm default, pnpm works).

## Don'ts

- Don't access database from frontend
- Don't build a Kysely instance or name a dialect outside `src/worker/db/`
- Don't run separate frontend/backend servers
- Don't rewrite a shadcn/ui component in place so it no longer matches the official one: small `// project:` edits are fine; a reworked component gets its own name outside `components/ui/`
- Don't hardcode URLs (use environment-based config)
- Don't deploy to production without the user's explicit approval, and never with raw `wrangler deploy`: use `npm run deploy:production` (`bin/deploy-production`)
- Don't call a service SDK/API directly from feature code when an adapter exists (go through `src/worker/adapters/`)
- Don't call the app's API with bare `fetch` (it would bypass the HTTP layer), and don't show API errors at call sites (`if (!res.ok) toast.error(...)`): use `http()`, with `handles` for statuses the call deals with itself
- Don't put internal details (SQL, ids of other users, stack traces) in an error's user message: they go in `log`

## Project-Specific Notes

> Developers: Add project-specific instructions below as the app evolves.
> Keep this section updated with domain models, business logic, and conventions.

---

*This file is read by AI coding agents. Keep it concise and actionable.*
