# Cloudflare Fullstack Starter

[![CI](https://github.com/claudio-silva/cloudflare-fullstack-starter/actions/workflows/ci.yml/badge.svg)](https://github.com/claudio-silva/cloudflare-fullstack-starter/actions/workflows/ci.yml)

A full-stack Cloudflare starter that gets you building real features immediately — production-ready, optimized for AI agents, and built to scale on Cloudflare’s global edge network.

Install it and start building. Authentication, database, UI, CLI, and deployment are all ready to go.

A great starting point for your next MVP or SaaS app.

---

## Why Cloudflare?

Cloudflare's developer platform offers a unique combination that's hard to match:

- **Edge performance** — Your code runs in 300+ data centers worldwide, milliseconds from your users
- **Unified stack** — Workers, D1 database, R2 storage, KV, Queues, and more, all integrated
- **Generous free tier** — Start with **zero cost**:
  - **Workers**: 100,000 requests/day
  - **D1 Database**: 5 GB storage, 5 million reads/day
  - **R2 Storage**: 10 GB storage, 1 million reads/month
  - Pay only when your project gains real traction
- **Zero cold starts** — Unlike traditional serverless, Workers start instantly
- **Simple deployment** — One command to deploy globally

This means you can build, launch, and validate your idea without upfront infrastructure costs. If it takes off, Cloudflare scales with you.

## Why This Starter?

Cloudflare gives you remarkable power at the edge, but it isn’t a traditional hosting platform. Most mainstream web frameworks don’t run on Workers out of the box, and adapting them to Cloudflare’s request-driven runtime can feel unfamiliar if you’re used to environments that hide the wiring. That early friction slows down the part you actually care about: building something new.

Agentic coding helps, but unfamiliar runtimes are still a weak spot. When developing for platforms like Cloudflare, agents rarely succeed on the first attempt. They burn cycles rebuilding boilerplate, fixing type and lint errors, debugging auth flows, smoothing out theme flicker, tweaking configs, and juggling multi-environment setups — all the fragile infrastructure work that slows real development. And every new project means repeating the same setup steps.

This starter removes that overhead entirely. From the moment you create a project from this template — or even ask your coding agent to install it for you — you begin with a fully working, production-ready foundation:

- **Complete Auth Flow** — Sign up, email verification, login, logout, profile management, powered by [Better Auth](https://www.better-auth.com/)
- **Database Ready** — [Cloudflare D1](https://developers.cloudflare.com/d1/) with migrations, used for auth but extensible
- **Beautiful UI** — 50+ [shadcn/ui](https://ui.shadcn.com/) components, dark/light theme with FOUC prevention
- **Full Stack** — React 19 + Vite frontend, [Hono](https://hono.dev/) API backend, unified dev server with hot reload
- **Multi-Environment** — Local, Preview, and Production environments with separate databases and secrets
- **CLI Tools** — User management commands, extensible for your own tooling
- **TypeScript** — Full type safety across frontend, backend, and database queries
- **CI/CD Ready** — GitHub Actions workflow validates every push: lint, type-check, and build must pass. Zero tolerance for warnings ensures your codebase stays clean as it evolves

### Alternative: Minimal Starting Point

If you just want a public website (landing page, marketing site), check out the **`minimal` branch** — stripped of authentication, database, CLI, and app shell, but still includes React, TypeScript, Vite, Hono, Workers, shadcn/ui, and Tailwind.

---

## 🤖 AI Agent Installation

**This template is designed for AI-assisted development.** It includes documentation that guides coding agents through setup and ongoing development.

### Install via AI Agent (Cursor, Windsurf, etc.)

If you're using an AI-powered IDE, you can ask your agent to install this template directly. Use this prompt:

> **Prompt:** Install the Cloudflare Fullstack Starter template into this project. Read the setup instructions at https://raw.githubusercontent.com/claudio-silva/cloudflare-fullstack-starter/main/docs/AGENTS_SETUP.md

Or use the slash command shortcut (if your IDE supports it):

```
/install-cloudflare-starter
```

<details>
<summary><strong>Instructions for adding the slash command</strong></summary>

#### Cursor

1. Open **Settings** → **Cursor Settings** → **Rules**
2. Under **User Rules**, click **Add new rule**
3. Create a rule with:
   - **Name:** `install-cloudflare-starter`
   - **Rule:**
     ```
     When the user types /install-cloudflare-starter, install the Cloudflare Fullstack Starter 
     template into the current project. First, read the setup instructions at:
     https://raw.githubusercontent.com/claudio-silva/cloudflare-fullstack-starter/main/docs/AGENTS_SETUP.md
     
     Follow those instructions to:
     1. Download and extract the template into the current directory
     2. Install dependencies
     3. Run the non-interactive init script with sensible defaults
     4. Verify the setup works
     
     The current directory may be empty or contain only IDE configuration files (like .cursor/).
     This is expected when starting a new project.
     ```

#### Windsurf

1. Open **Settings** → **AI Settings** → **Custom Commands**
2. Add a new command with similar instructions

</details>

### What the Agent Gets

- **[AGENTS.md](AGENTS.md)** — Architecture overview, key patterns, common tasks for ongoing development
- **[docs/AGENTS_SETUP.md](docs/AGENTS_SETUP.md)** — Non-interactive setup instructions for initial installation

---

## Quick Start

> ⚠️ Do **not** clone this repo directly for your project. Follow the instructions below to create your own copy, so pushes go to your repo.

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
The script:
- Leaves the env templates unchanged
- Copies them to `.env.local` / `.env.preview` / `.env.production` if missing
- Applies your domain values only to those `.env.*` files (safe to keep out of git)

### 4. Start development

```bash
npm run dev
```

Open http://localhost:5173 — you'll see the login overlay. Sign up to create your first account.

## Just want a quick peek?

Click to deploy a temporary preview to Cloudflare:

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/claudio-silva/cloudflare-fullstack-starter)

Fast path (no email confirmation needed):
1) In the wizard, keep defaults. When prompted for a database, create/bind a D1 database and name the binding `starter` (required for auth). No other env vars needed.
2) Deploy, then open the provided URL.
3) On the login overlay, click “Sign up”, create an account, and sign in. With the default `ENVIRONMENT=local`, email verification is skipped.

Note that this is a **temporary preview**, so you should **discard it after testing** by deleting the Worker and the D1 DB from the Cloudflare dashboard or CLI.

#### To discard the preview

##### Via Dashboard
Workers & Pages → select the deployed worker → Settings → Delete (and delete  the D1 DB too).

##### Via CLI
If wrangler is logged in, you can do it from the command line:

  ```bash
  npx wrangler delete starter          # remove worker
  npx wrangler d1 delete starter --yes # remove D1 database (if created)
  ```

---

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
- Clean top header bar with logo and user menu
- Avatar dropdown with user info, Profile, and Sign Out
- Dark/light theme toggle with FOUC prevention
- Theme-aware logo component (auto-switches light/dark)
- Theme can be passed via URL parameter for cross-app navigation
- 50+ shadcn/ui components ready to use

## Project Structure

```
├── src/
│   ├── react-app/           # React frontend
│   │   ├── assets/          # Static assets (logo-light.svg, logo-dark.svg)
│   │   ├── components/
│   │   │   ├── auth/        # Auth components (LoginForm, ProtectedRoute, AuthOverlay)
│   │   │   ├── ui/          # shadcn/ui components
│   │   │   ├── TopBar.tsx   # Header with logo and user menu
│   │   │   ├── Logo.tsx     # Theme-aware logo
│   │   │   └── ModeToggle.tsx # Theme toggle
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

Manage users directly from your terminal — useful for creating admin accounts, debugging, or scripting.

> ⚠️ When managing local users, **the dev server must be running** (`npm run dev`) for these commands to work. They communicate with the API at `http://localhost:5173`.

```bash
# List all users (shows email, name, verification status, creation date)
npm run auth list-users
npm run auth list-users -- --limit 10           # limit results
npm run auth list-users -- --search "john"      # search by email or name

# Create a new user (useful for seeding admin accounts)
npm run auth create-user -- -u admin@example.com -p password123
npm run auth create-user -- -u admin@example.com -p password123 -n "Admin User"

# View detailed user info (includes account provider, sessions, timestamps)
npm run auth show-user -- -u admin@example.com

# Edit user details
npm run auth edit-user -- -u admin@example.com -n "New Name"
npm run auth edit-user -- -u admin@example.com -e newemail@example.com
npm run auth edit-user -- -u admin@example.com -p newpassword123

# Activate or deactivate a user account
npm run auth activate-user -- -u admin@example.com -s on   # activate
npm run auth activate-user -- -u admin@example.com -s off  # deactivate

# Delete a user (removes user, accounts, and sessions)
npm run auth delete-user -- -u admin@example.com
npm run auth delete-user -- --all                          # delete ALL users (use with caution)
```

For remote environments, use the `--env` flag and set `CLI_ADMIN_EMAIL`/`CLI_ADMIN_PASSWORD` in your `.env.*` file:
```bash
npm run auth list-users -- --env preview
npm run auth list-users -- --env production
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
3. Wrap with `<ProtectedRoute>` and `<TopBar>` if auth required
4. Add navigation as appropriate for your app design

### Email Provider
Replace `createResendEmailSender` in `src/worker/middleware/auth.ts` with your provider implementing the `EmailSender` interface.

## For AI Coding Agents

This template is optimized for AI-assisted development:

- **[docs/AGENTS_SETUP.md](docs/AGENTS_SETUP.md)** — Non-interactive setup instructions for initial installation
- **[AGENTS.md](AGENTS.md)** — Architecture, patterns, and common tasks for ongoing development

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
