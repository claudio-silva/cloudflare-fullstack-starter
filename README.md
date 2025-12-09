# Cloudflare Fullstack SaaS Starter

[![CI](https://github.com/claudio-silva/cloudflare-fullstack-starter/actions/workflows/ci.yml/badge.svg)](https://github.com/claudio-silva/cloudflare-fullstack-starter/actions/workflows/ci.yml) [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/claudio-silva/cloudflare-fullstack-starter)

**Production-ready SaaS foundation** on Cloudflare's edge platform.  
Clone, init and start building your web app. Authentication, database, UI, CLI and deployment are all ready to go.

## Why This Starter?

Building a new project should feel exciting, not like a ritual of fixing boilerplate. Even with coding agents, early development often dissolves into hours of debugging authentication flows, taming theme flicker, setting up configurations and multi-environment support, and recreating the same foundations over and over. It slows you down, burns credits, and drains enthusiasm before you even touch the core idea.

This starter lets you skip that entire setup grind. From the first `git clone`, you begin with a fully working, production‑grade baseline:

- **Complete Edge Runtime**: Built on Cloudflare's edge platform, ready to deploy to Cloudflare Workers/Pages
- **TypeScript**: Built-in TypeScript support, linting and type checking with frontend and backend live reload
- **Complete Auth Flow**: Sign up, email verification, login, logout, profile management, all powered by [Better Auth](https://www.better-auth.com/)
- **App Shell**: Sidebar navigation + header with theme toggle and user avatar dropdown menu + Profile page and Logout — which you can redesign to your liking
- **Database Ready**: [Cloudflare D1](https://developers.cloudflare.com/d1/) with migrations — easily replaceable with another database backend
- **Beautiful UI**: 50+ [shadcn/ui](https://ui.shadcn.com/) components pre-installed, user-selectable dark/light theme
- **Full Stack**: React 19 + Vite frontend, [Hono](https://hono.dev/) API backend, unified dev server
- **Multi-Environment Support**: Local, Preview and Production environments with separate databases and secrets
- **CLI Tools**: A base for your own CLI tooling, bundles a useful set of commands for managing local and remote users

### Alternative: Minimal Starting Point

If you prefer a bare‑bones starting point stripped of authentication, database, CLI, and app shell, check out the `minimal` branch of this repository. It still provides React with TypeScript, integrated Vite and Hono backend, Cloudflare Workers, shadcn/ui components and Tailwind CSS.

## Quick Start

### 1. Create from template

Click **"Use this template"** on GitHub, or use the CLI:
```bash
gh repo create my-app --template claudio-silva/cloudflare-fullstack-starter --clone
cd my-app
```

### 2. Install dependencies

```bash
npm install
# or: pnpm install
```

### 3. Initialize project

Run the interactive init script. It will ask for your project name and domain URLs, then run the database migrations:
```bash
npm run init
```

### 4. Start development

```bash
npm run dev
```

Open http://localhost:5173 — you'll see the login overlay. Sign up to create your first account.

## What's Included

### Tech Stack
| Layer | Technology |
|-------|------------|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS, shadcn/ui |
| Backend | Hono (Workers), Better Auth, Kysely |
| Database | Cloudflare D1 (SQLite) |
| Email | Resend (pluggable) |
| Deploy | Cloudflare Workers/Pages |

### Auth Features
- Email/password authentication with email verification
- Session management with secure cookies
- Protected routes with seamless authentication overlay that prevents content flashing and needless page reloads
- Profile page (update name, email, password)
- CLI user management (create, list, view, edit, delete, activate)

### UI Features
- Responsive sidebar + header layout
- Avatar dropdown with Profile/Logout
- Dark/light theme with FOUC prevention
- 50+ shadcn/ui components ready to use

## Project Structure

```
├── src/
│   ├── react-app/           # React frontend
│   │   ├── components/
│   │   │   ├── auth/        # Auth components (LoginForm, ProtectedRoute)
│   │   │   ├── ui/          # shadcn/ui components
│   │   │   └── AppShell.tsx # Sidebar + header layout
│   │   ├── pages/           # Route pages (Home, Profile, auth/)
│   │   └── lib/auth/        # Better Auth client
│   └── worker/              # Hono API backend
│       ├── middleware/      # Auth middleware
│       ├── utils/           # Email templates, Resend
│       └── index.ts         # API routes
├── src/cli/                 # CLI commands
├── bin/                     # CLI entry points
├── migrations/              # D1 SQL migrations
├── wrangler.toml            # Cloudflare config
└── AGENTS.md                # Instructions for AI coding agents
```

## CLI Commands

### Auth Management

```bash
npm run auth list-users
npm run auth create-user -- -u admin@example.com -p password123
npm run auth show-user -- -u admin@example.com
npm run auth edit-user -- -u admin@example.com -n "Admin User"
npm run auth activate-user -- -u admin@example.com -s on
npm run auth delete-user -- -u admin@example.com
```

Or call directly:
```bash
./bin/auth list-users --env local
```

### Database

```bash
# Local development
npm run db:migrate:local
npm run db:seed:local

# Preview/Production (set D1 IDs in wrangler.toml first)
npm run db:migrate:preview
npm run db:migrate:production
```

## Environment Setup

### Local Development

The app runs locally without any configuration. To enable email verification, copy the example and add your [Resend](https://resend.com/) API key:
```bash
cp .env.example .env.local
```

```env
RESEND_API_KEY=re_xxxxxxxxxxxxx
```

### Preview/Production
1. Create D1 databases in Cloudflare dashboard
2. Update `wrangler.toml` with database IDs
3. Set secrets via Cloudflare dashboard or CLI:
   ```bash
   wrangler secret put RESEND_API_KEY --env production
   ```

## Development

```bash
npm run dev          # Start dev server (http://localhost:5173)
npm run build        # Build for production
npm run preview      # Preview production build
npm run lint         # Run ESLint
npm run check        # Type check + build + deploy dry-run
```

## Deploy

```bash
npm run deploy:production    # Deploy to production
npm run deploy:preview       # Deploy to preview
```

## Customization

### Branding
Search and replace these placeholders:
- `"My App"` in email templates and UI
- `noreply@example.com` in email sender
- Domain URLs in `.env.example` and `env/` templates

### Adding Pages
1. Create page in `src/react-app/pages/`
2. Add route in `src/react-app/App.tsx`
3. Wrap with `<ProtectedRoute>` if auth required
4. Add to sidebar in `src/react-app/components/AppShell.tsx`

### Email Provider
Replace `createResendEmailSender` in `src/worker/middleware/auth.ts` with your provider implementing the `EmailSender` interface.

## For AI Coding Agents

If you're an AI agent setting up this template, see **[docs/AGENTS_SETUP.md](docs/AGENTS_SETUP.md)** for non-interactive setup instructions.

For ongoing development guidance, see **[AGENTS.md](AGENTS.md)**.

## Additional Resources

- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Cloudflare D1](https://developers.cloudflare.com/d1/)
- [Better Auth](https://www.better-auth.com/)
- [Hono](https://hono.dev/)
- [shadcn/ui](https://ui.shadcn.com/)
- [Vite](https://vitejs.dev/)

## License

This template is open source and available under the [MIT License](LICENSE).  
It was based on the [Cloudflare Fullstack Template](https://github.com/cloudflare/templates/tree/main/vite-react-template) by Cloudflare.

(c) 2025 Claudio Silva
