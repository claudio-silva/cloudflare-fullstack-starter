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
│   ├── components/
│   │   ├── auth/           # Auth UI (LoginForm, ProtectedRoute, AuthOverlay)
│   │   ├── ui/             # shadcn/ui components
│   │   ├── AppShell.tsx    # Sidebar + header layout
│   │   └── theme-provider.tsx
│   ├── pages/              # Route pages
│   │   ├── auth/           # SignUp, VerifyEmail
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
pnpm dev                    # Start dev server

# Database
pnpm db:migrate:local       # Run migrations

# Auth CLI
pnpm auth list-users        # List all users
pnpm auth create-user -u email -p pass  # Create user
pnpm auth delete-user -u email          # Delete user

# Build & Deploy
pnpm build                  # Build for production
pnpm deploy:production      # Deploy to Cloudflare
```

## Common Tasks

### Add a New Page
1. Create `src/react-app/pages/MyPage.tsx`
2. Add route in `src/react-app/App.tsx`
3. Add nav item in `src/react-app/components/AppShell.tsx`

### Add an API Endpoint
1. Add route in `src/worker/index.ts`
2. Use `authMiddleware` if authentication required
3. Access D1 via `c.env.DB`

### Add Database Table
1. Create migration in `migrations/`
2. Add types to `src/worker/types/database.ts`
3. Run `pnpm db:migrate:local`

## Environment

- `wrangler.toml` — Non-secret config (D1 bindings, env vars)
- `.env.local` — Secrets (RESEND_API_KEY, CLI credentials)
- Local dev works without Resend; email verification skipped

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
