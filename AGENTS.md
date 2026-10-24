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
- **Never** try to run separate servers or configure proxies

### API-Only Database Access
**Never** import Kysely or access D1 directly in frontend code. Always use HTTP APIs:
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
bin/                        # CLI entry points (init, auth, db)
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

### Using shadcn/ui Components
Components are in `@/components/ui/`. Import directly:
```tsx
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
```

See `docs/SHADCN_COMPONENTS.md` for the full component list.

### Database Queries (Backend Only)
Get the connection from the single factory in `src/worker/db`; never construct Kysely in routes:
```typescript
import { createDb } from "../db";

const db = createDb(c.env);
const users = await db.selectFrom("users").selectAll().execute();
```
**Portability scope:** starter-owned database code (the auth tables, the CLI routes, migrations 0001-0003, seed helpers) is kept portable across D1/SQLite, PostgreSQL and MySQL so every supported database works out of the box; keep it that way when you edit those files (helpers: `dbNow()`, `dbBool()`, `toIso()`, `ignoreConflict()`, `columnTypes()`). **Your own code is not restricted:** once the project has chosen its database, use whatever that database supports (transactions on PostgreSQL/MySQL, `RETURNING`, native types, raw SQL). Differences worth knowing, other databases and provider APIs: `docs/DATABASES.md`.

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
npm run auth activate-user
npm run auth set-role
npm run auth show-user

# Build & Deploy
npm run build                  # Build for production
npm run deploy:production      # Versioned release: secrets + build vars + build + deploy + tag + migrate (patch; --minor/--major)
npm run deploy:preview         # Same steps on preview, without versioning

# Logs (deployed environments only)
npm run tail:preview           # Stream logs from preview
npm run tail:production        # Stream logs from production
```

## Common Tasks

### Add a New Page
1. Create `src/react-app/pages/MyPage.tsx`
2. Add route in `src/react-app/App.tsx` wrapped with `<ProtectedRoute>` and `<TopBar>` if needed
3. Add navigation as appropriate for your app (TopBar doesn't include nav by default)

### Add an API Endpoint
1. Add a module in `src/worker/routes/` and mount it in `src/worker/index.ts` with `app.route()`
2. Use `authMiddleware` if authentication required
3. Access D1 via `c.env.DB`

### Add Database Table
1. `npm run db -- new-migration <snake_case_name>` scaffolds the file and registers it in `migrations/index.ts`; mirror the change in `baseline.ts` (append the name to `squashes`)
2. Add types to `src/worker/types/database.ts`
3. `npm test` (a drift test checks baseline == incrementals on every database); local dev migrates automatically
4. For remote envs, prefer `npm run db:migrate:preview:safe` / `npm run db:migrate:production:safe` (takes a backup first)

#### Sign-in log

`login_events` records every sign-in attempt, successful or failed, with IP, user agent and country. `sessions` cannot answer "who has used this app": it holds only sessions that still exist. Read it with `npm run db -- logins --env <env>`.

IPs are personal data, so the cron in `src/worker/scheduled.ts` prunes the table after `AUTH_LOG_RETENTION_DAYS` (default 90) and your privacy notice has to mention it.

## Writing migrations

Scaffold with `npm run db -- new-migration <snake_case_name>`; never hand-write the file or forget to register it.

Every migration declares **`compatibility`**, and that decides when the deploy runs it:

| Value | Use for | Runs |
|---|---|---|
| `expand` (default) | new tables, nullable columns, columns with a default, indexes | before the deploy |
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
- `.env.preview` / `.env.production` — Synced to Cloudflare before deploy (secrets to the Worker; `VITE_*` and `CLI_API_URL*` to Workers Builds as build variables)

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
- Both deploy commands run pending DB migrations after `wrangler deploy` (through the Worker), so write migrations **additive and backward-compatible**: the new code serves traffic before the schema changes.
- The release version is `version` in `package.json` (git tag `vX.Y.Z` on `main`), exposed as `APP_VERSION` / `APP_COMMIT` (`src/shared/app-version.ts`) and in `GET /api/`.

**CLI auth (`CLI_API_KEY`):**
- The auth CLI authenticates to `/api/cli/*` using a shared `CLI_API_KEY` secret sent as `x-api-key`.
- Generate one per environment: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
- Set it in each `.env.<env>` file; the deploy scripts sync it to the Worker automatically.

## Platform Philosophy: Cloudflare-First, Not Cloudflare-Only

Prefer Cloudflare services (D1, Email Service, R2, KV, Durable Objects, ...) whenever one fits: cost, simplicity and latency are the reasons this starter exists. But never force them: if the user prefers another provider, or is converting a project that already uses one, support it.

Services that can reasonably be swapped sit behind an **adapter**: a small interface in `src/worker/adapters/<service>/types.ts`, one file per implementation, and a registry in `index.ts` that picks the implementation from `src/config.ts`. Feature code only imports the registry. Email is the reference example:

- Interface: `EmailSender.sendEmail({ to, subject, html, text? })`
- Implementations: `cloudflare.ts` (default); add others beside it
- Selection: `config.email.provider`; provider secrets live in `.env.<env>`

To add or replace a provider, follow `docs/EMAIL.md`.

**Data:** D1 is the default, but the schema, migrations, seeds, auth and tests are portable across D1/SQLite, PostgreSQL and MySQL (all tested). Connections come from `createDb()` in `src/worker/db`; for another SQL database, a second store, or a provider SDK (Supabase, Neon, ...), follow `docs/DATABASES.md`. Backup/restore work on every supported database (logical, through the Worker API); only time-travel is D1-specific. Prefer keeping auth on D1 and putting domain data elsewhere if a provider is wanted. When a user brings a new service need that has Cloudflare and non-Cloudflare options, introduce an adapter following the same pattern rather than hard-wiring either.

## Downstream Projects

`package.json` has a `starter` field (`starter.version`) recording which starter release the project is based on. Keep it, and update it only as part of an upgrade (see `UPGRADING.md`).

Projects built on this starter should edit few starter files so later upstream pulls stay cheap. Put project-specific values in `src/config.ts`, `wrangler.toml` vars/bindings and the `env/*.template` files, and add features as new files (routes, pages) rather than rewriting starter ones. `vite.config.ts` copies every key under `[env.*]` from `wrangler.toml` into the deploy config generically, so new bindings need no change there; see `docs/VITE_CLOUDFLARE_BRIDGE.md`. Scripts are package-manager agnostic (npm default, pnpm works).

## UI Components

Use the bundled shadcn/ui components (`@/components/ui/`) first, or compositions of them. Import an external component library or write a custom component only when nothing bundled covers the need or an external implementation is clearly better.

## Don'ts

- Don't access database from frontend
- Don't build a Kysely instance or name a dialect outside `src/worker/db/`
- Don't run separate frontend/backend servers
- Don't modify shadcn/ui component internals (extend with wrappers)
- Don't hardcode URLs (use environment-based config)
- Don't deploy to production without the user's explicit approval, and never with raw `wrangler deploy`: use `npm run deploy:production` (`bin/deploy-production`)
- Don't call a service SDK/API directly from feature code when an adapter exists (go through `src/worker/adapters/`)

## Project-Specific Notes

> Developers: Add project-specific instructions below as the app evolves.
> Keep this section updated with domain models, business logic, and conventions.

---

*This file is read by AI coding agents. Keep it concise and actionable.*
