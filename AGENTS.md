# AI Agent Development Guide

> Essential instructions for AI coding agents working on this project.
> For initial setup, see `docs/AGENTS_SETUP.md`.

## Project Overview

The project is based on a SaaS starter template built on Cloudflare's edge platform with:
- **Frontend**: React 19 + TypeScript + Vite + Tailwind CSS + shadcn/ui
- **Backend**: Hono on Cloudflare Workers
- **Database**: Cloudflare D1 (SQLite at the edge)
- **Auth**: Better Auth (email/password with verification)
- **Email**: Resend (pluggable provider)

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
    ├── index.ts            # API routes + CLI endpoints
    ├── middleware/auth.ts  # Better Auth config
    ├── types/database.ts   # Kysely types
    └── utils/              # Email templates, Resend

src/cli/                    # CLI commands (manage users via API)
src/config.ts               # Global app configuration (app name, etc.)
bin/                        # CLI entry points (init, auth)
migrations/                 # D1 SQL migrations
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
Add routes in `src/worker/index.ts`:
```typescript
// Public endpoint
app.get("/api/health", (c) => c.json({ status: "ok" }));

// Protected endpoint (requires auth)
app.use("/api/protected/*", authMiddleware);
app.get("/api/protected/data", async (c) => {
  const user = c.get("user");
  // ...
});
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

```bash
# Development
pnpm dev                    # Start dev server (logs appear in terminal)

# Database
pnpm db:migrate:local       # Run migrations

# Auth CLI
pnpm auth list-users        # List all users
pnpm auth create-user -u email -p pass  # Create user
pnpm auth delete-user -u email          # Delete user

# Build & Deploy
pnpm build                  # Build for production
pnpm deploy:production      # Deploy to Cloudflare (auto-syncs secrets)

# Logs (deployed environments only)
pnpm tail:preview           # Stream logs from preview
pnpm tail:production        # Stream logs from production
```

## Common Tasks

### Add a New Page
1. Create `src/react-app/pages/MyPage.tsx`
2. Add route in `src/react-app/App.tsx` wrapped with `<ProtectedRoute>` and `<TopBar>` if needed
3. Add navigation as appropriate for your app (TopBar doesn't include nav by default)

### Add an API Endpoint
1. Add route in `src/worker/index.ts`
2. Use `authMiddleware` if authentication required
3. Access D1 via `c.env.DB`

### Add Database Table
1. Create migration in `migrations/`
2. Add types to `src/worker/types/database.ts`
3. Run `pnpm db:migrate:local`

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
- `.env.local` — Loaded during local development (`pnpm dev`)
- `.env.preview` / `.env.production` — Synced to Cloudflare before deploy

**Variable access by context:**
```typescript
// Client-side (React) - only VITE_ prefixed variables
const apiUrl = import.meta.env.VITE_API_URL;

// Server-side (Worker) - all variables from wrangler.toml + .env files
const resendKey = c.env.RESEND_API_KEY;
const environment = c.env.ENVIRONMENT;  // from wrangler.toml
```

**Deploying secrets:**
- `pnpm deploy:preview` / `pnpm deploy:production` automatically syncs secrets from `.env.<env>` files
- Only changed secrets are synced (tracked via hash file)

## Don'ts

- Don't access database from frontend
- Don't run separate frontend/backend servers
- Don't modify shadcn/ui component internals (extend with wrappers)
- Don't hardcode URLs (use environment-based config)

## Project-Specific Notes

> Developers: Add project-specific instructions below as the app evolves.
> Keep this section updated with domain models, business logic, and conventions.

---

*This file is read by AI coding agents. Keep it concise and actionable.*
