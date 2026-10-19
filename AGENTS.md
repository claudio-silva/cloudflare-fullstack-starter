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
    ├── index.ts            # Mounts routes with app.route(); exports Durable Objects
    ├── routes/             # One file per feature (cli.ts, profile.ts, ...)
    ├── durable-objects/    # Durable Object classes (example included)
    ├── middleware/auth.ts  # Better Auth config
    ├── types/database.ts   # Kysely types
    ├── adapters/           # Swappable service adapters (email)
    └── utils/              # Email templates and helpers

src/cli/                    # CLI commands (auth user management + db utilities)
src/config.ts               # Global app configuration (app name, etc.)
bin/                        # CLI entry points (init, auth, db)
test/                       # Vitest worker integration tests (D1 migrations applied)
e2e/                        # Playwright smoke tests
migrations/                 # D1 SQL migrations
seeds/                      # Idempotent SQL seed files
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
Use Kysely in worker code:
```typescript
import { Kysely } from "kysely";
import { D1Dialect } from "kysely-d1";
import type { Database } from "./types/database";

const db = new Kysely<Database>({
  dialect: new D1Dialect({ database: c.env.DB }),
});

const users = await db.selectFrom("users").selectAll().execute();
```

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
npm run db:backup        # Export local D1 to .wrangler/backups/
npm run db:backup:production   # Export production D1 to .wrangler/backups/
npm run db:restore:latest        # Restore latest backup (auto-backs-up current DB first)
npm run db:restore -- --env production --file prod-backup.sql

# Database — time-travel (remote envs only)
npm run db:time-travel:info -- --env production
npm run db:time-travel:restore -- --env production --timestamp "2026-04-01 12:00:00"

# Database — seeds
npm run db:seed -- --env local --file admin-bootstrap.sql

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
npm run deploy:production      # Deploy to Cloudflare (auto-syncs secrets)

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
1. Create migration in `migrations/`
2. Add types to `src/worker/types/database.ts`
3. Run `npm run db:migrate`
4. For remote envs, prefer `npm run db:migrate:preview:safe` / `npm run db:migrate:production:safe` (takes a backup first)

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
- `.env.preview` / `.env.production` — Synced to Cloudflare before deploy

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

To add or replace a provider, follow `docs/EMAIL.md`. When a user brings a new service need that has Cloudflare and non-Cloudflare options, introduce an adapter following the same pattern rather than hard-wiring either.

## Downstream Projects

`package.json` has a `starter` field (`starter.version`) recording which starter release the project is based on. Keep it, and update it only as part of an upgrade (see `UPGRADING.md`).

Projects built on this starter should edit few starter files so later upstream pulls stay cheap. Put project-specific values in `src/config.ts`, `wrangler.toml` vars/bindings and the `env/*.template` files, and add features as new files (routes, pages) rather than rewriting starter ones. Durable Objects need a top-level binding plus a migration tag; see `docs/VITE_CLOUDFLARE_BRIDGE.md`. Scripts are package-manager agnostic (npm default, pnpm works).

## UI Components

Use the bundled shadcn/ui components (`@/components/ui/`) first, or compositions of them. Import an external component library or write a custom component only when nothing bundled covers the need or an external implementation is clearly better.

## Don'ts

- Don't access database from frontend
- Don't run separate frontend/backend servers
- Don't modify shadcn/ui component internals (extend with wrappers)
- Don't hardcode URLs (use environment-based config)
- Don't call a service SDK/API directly from feature code when an adapter exists (go through `src/worker/adapters/`)

## Project-Specific Notes

> Developers: Add project-specific instructions below as the app evolves.
> Keep this section updated with domain models, business logic, and conventions.

---

*This file is read by AI coding agents. Keep it concise and actionable.*
