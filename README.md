# Cloudflare Full-Stack Starter

[![CI](https://github.com/claudio-silva/cloudflare-fullstack-starter/actions/workflows/ci.yml/badge.svg)](https://github.com/claudio-silva/cloudflare-fullstack-starter/actions/workflows/ci.yml)

**A full-stack project starter that gets you building real features immediately** — production-ready, set up for AI agentic coding, and built to scale on Cloudflare’s global edge network.

Install and start building. Authentication, database, UI, CLI, and deployment are all ready to go.

A great starting point for your next **MVP** or **SaaS** app.

---

## Why This Starter?

Cloudflare gives you remarkable power at the edge, but **it isn’t a traditional hosting platform**. Most mainstream web frameworks don’t run on Workers out of the box, and adapting them to Cloudflare’s request-driven runtime can be challenging. That early friction slows down the part you actually care about: *building something new*.

Agentic coding helps, but unfamiliar runtimes are still a weak spot. When developing for platforms like Cloudflare, **agents rarely succeed on the first attempt**. They burn cycles building boilerplate, fixing type and lint errors, debugging auth flows, smoothing out theme flicker, tweaking configs, juggling multi-environment setups and many other small details — all the fragile infrastructure work that slows real development. And **every new project** means **repeating the same setup steps**.

This starter removes that overhead **entirely**. Create a project from the template — or have your coding agent set it up — and you begin with a fully working, production-ready foundation. You can focus on building the distinctive parts of your app **right away**.

## Features

| Feature | What it brings you |
|---------|-------------|
| **Full-Stack** | React 19 + Vite frontend + [Hono](https://hono.dev/) API backend, unified dev server |
| **API routes on workers** | Hono's elegant routing for backend endpoints |
| **Hot Module Replacement** (HMR) | Rapid development with instant updates |
| **TypeScript + ESLint** | Full type safety across frontend, backend, and database queries |
| **Database Ready** | [Cloudflare D1](https://developers.cloudflare.com/d1/) with migrations, backup/restore, time-travel, and seeding — all from the CLI, for every environment |
| **Multi-Environment** | Local, Preview, and Production environments with separate databases, configurations and secrets |
| **Secrets Management** | Secrets are automatically synced from `.env.<env>` files to Cloudflare (optional), no need to manually set them in the dashboard (but you still can) |
| **Complete Auth Flow** | Sign up, email verification, login, logout, profile management, powered by [Better Auth](https://www.better-auth.com/) |
| **Transactional emails** | Email verification and password reset with Resend (easy to change to other providers) |
| **CLI Tools** | User management and full database tooling (migrate, backup, restore, time-travel, seed) across all environments, from your terminal |
| **Dead simple deployment** | Deploy to Cloudflare's global network with one command |
| **Built-in Observability** | Monitor your Worker logs, metrics, traces, performance and health |
| **CI/CD Ready** | GitHub Actions workflow validates every push: lint, type-check, and build must pass.<br>You can also display the CI status badge in your README.md |
| **Beautiful UI** | 50+ [shadcn/ui](https://ui.shadcn.com/) components, dark/light theme with FOUC prevention |
| **AI-Assisted Installation and Development** | [AGENTS_SETUP.md](docs/AGENTS_SETUP.md) and [AGENTS.md](AGENTS.md) are included for easy installation and enhanced development assistance |

### Alternative: Public Website Template

If you just want a public website (**landing page, marketing site**), check out the **`minimal` branch** — stripped of authentication, database, CLI, and app shell, but still includes React, TypeScript, Vite, Hono, Workers, shadcn/ui, and Tailwind.

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

This means you can build, launch, and validate your idea **without upfront infrastructure costs**. If it takes off, Cloudflare **scales** with you, seamlessly.

---

## 🧠 AI-Assisted Development

**This template is designed for AI-assisted development.**

It includes **[AGENTS.md](AGENTS.md)**, a concise but still comprehensive guide that **helps coding agents** understand the project architecture, key patterns, and common tasks.

This is especially important when dealing with unfamiliar runtimes like Cloudflare Workers. Without such guidance, agents often struggle to understand the platform and its quirks, leading to frustration and slow progress.

---

## 🤖 AI Agent Installation

If you're using an AI-powered IDE (Cursor, Windsurf, etc.), you can ask your agent to install this template directly. Use this prompt:

> **Prompt:** Install the Cloudflare Full-Stack Starter template into this project. Read the setup instructions at https://raw.githubusercontent.com/claudio-silva/cloudflare-fullstack-starter/main/docs/AGENTS_SETUP.md

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
     Install the Cloudflare Full-Stack Starter template into the current project. First, read the setup instructions at:
     https://raw.githubusercontent.com/claudio-silva/cloudflare-fullstack-starter/main/docs/AGENTS_SETUP.md
     
     Follow those instructions to:
     1. Download and extract the template into the current directory
     2. Install dependencies
     3. Run the non-interactive init script with sensible defaults
     4. Verify the setup works
     
     The current directory may be empty or contain only IDE configuration files — this is expected when starting a new project.
     ```

#### Windsurf

1. Open **Settings** → **AI Settings** → **Custom Commands**
2. Add a new command with similar instructions

</details>

<br>

The agent will follow the instructions in **[docs/AGENTS_SETUP.md](docs/AGENTS_SETUP.md)** to set up the project.

---

## Manual Installation

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

Run the interactive init script. It will ask for your project name and domain URLs for preview and production environments:
```bash
npm run init
```
The script:
- Copies template files to `.env.local` / `.env.preview` / `.env.production` (if missing) and fills in your choices

### 4. Set `CLI_API_KEY`

Before using the auth CLI, generate a random key and add it to `.env.local` (and the remote `.env.*` files when you set up preview/production):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
# paste the output as: CLI_API_KEY=<value>
```

The same key must also be deployed to the Worker — the deploy scripts sync it automatically from the `.env.*` file.

### 5. Run migrations and start development

```bash
npm run db:migrate:local
```

### 6. Start development

```bash
npm run dev
```

Open http://localhost:5173 — you'll see the login page. Sign up to create your first account.

## Preview Installation

**Just want a quick peek?**

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
| Component | Technology |
|-------|------------|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS, shadcn/ui |
| Backend | Hono (Workers), Cloudflare Vite Plugin, Better Auth, Kysely |
| Database | Cloudflare D1 (clustered SQLite) |
| Email | Resend (pluggable) |
| Deployment | Cloudflare Workers/Pages Runtime |

### Auth Features
- Email/password authentication with email verification and password reset
- Session management with secure cookies
- Protected routes with seamless authentication overlay that prevents content flashing and needless page reloads
- CLI user management (create, list, view, edit, delete, activate) for local and remote environments, with positional env shorthand (`npm run auth list-users production`)

### Database Features
- D1 migrations applied per-environment via `npm run db:migrate:*`
- **Safe migrate** — automatically takes a pre-migration backup before applying schema changes (`--safe`)
- **Backup** — export any environment's D1 database to a timestamped `.sql` file in `.wrangler/backups/` with one command
- **Restore** — restore from any backup file; for local databases, the current SQLite file is auto-backed-up before overwrite
- **Backup management** — list and clean up old backups per-environment, with `--dry-run` and `--all` options
- **Time Travel** — inspect and restore to any historical state of a remote D1 database using Cloudflare's built-in time-travel (point-in-time restore by timestamp or bookmark)
- **Seeds** — run idempotent SQL files from `seeds/` against any environment, separately from migrations

### UI Features
- Minimalistic app shell, so that you are free to create your own design and branding
- Clean top header bar with logo and user menu
- Avatar dropdown with user info, Profile, and Sign Out
- Profile page (update name, email, password; delete account)
- Dark/light theme toggle with FOUC prevention
- Theme-aware logo component (auto-switches light/dark)
- Theme can be passed via URL parameter for cross-app preference carry-over (e.g. from landing page to app)
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
├── src/cli/                 # CLI commands (auth user management, db utilities)
├── bin/                     # CLI entry points (init, auth, db)
├── migrations/              # D1 SQL migrations
├── seeds/                   # Idempotent SQL seed files (see seeds/README.md)
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

For remote environments, set `CLI_API_KEY` in your `.env.*` file (same value must be deployed to the Worker). You can pass the environment as a flag or as a positional argument:
```bash
npm run auth list-users -- --env preview
npm run auth list-users -- --env production

# Positional shorthand (equivalent)
npm run auth list-users production
npm run auth show-user -- -u admin@example.com production
```

The `.env.<env>` file is loaded automatically when a remote environment is targeted, so no manual `source` is needed.

### Database

```bash
# Migrations
npm run db:migrate:local
npm run db:migrate:preview
npm run db:migrate:production

# Safe migrate: takes a backup before applying (recommended for remote envs)
npm run db:migrate:preview:safe
npm run db:migrate:production:safe

# Backups — export D1 to a .sql file in .wrangler/backups/
npm run db:backup:local
npm run db:backup:preview
npm run db:backup:production
npm run db:backup:all         # all three environments at once

# List backup files
npm run db:backups:local
npm run db:backups:production
npm run db:backups -- --env preview --archive-dir ./.my-backups

# Clean up backup files
npm run db:backups:clean:local
npm run db:backups:clean -- --env local --all        # delete without prompting
npm run db:backups:clean -- --env local --dry-run    # preview what would be deleted

# Restore from backup
npm run db:restore:local:latest                                         # auto-picks latest, auto-backs-up existing local DB first
npm run db:restore -- --env local --file my-backup.sql
npm run db:restore -- --env preview --file preview-backup.sql
npm run db:restore -- --env production --file production-backup.sql

# Time Travel (remote envs only — requires D1 Time Travel to be enabled)
npm run db:time-travel -- --env preview time-travel info
npm run db:time-travel:info -- --env preview --timestamp "2026-04-01 12:00:00"
npm run db:time-travel:restore -- --env production --timestamp "2026-04-01 12:00:00"
npm run db:time-travel:restore -- --env production --bookmark <bookmark-id>

# Seeds — run idempotent SQL files from the seeds/ directory
npm run db:seed:local                                                    # auto-picks if only one .sql in seeds/
npm run db:seed -- --env local --file admin-bootstrap.sql
npm run db:seed -- --env preview --file admin-bootstrap.sql
npm run db:seed -- --env production --file admin-bootstrap.sql
```

> **Tip:** You can pass extra options after `--` in any `npm run db:*` shorthand, e.g. `npm run db:backup:local -- --archive-dir ./tmp`.

See [`seeds/README.md`](seeds/README.md) for the seed convention and idempotency requirements.

## Environment Setup

### Local Development

The app runs locally without any configuration. To enable email verification, add your [Resend](https://resend.com/) API key to `.env.local`:
```bash
echo "RESEND_API_KEY=re_xxxxxxxxxxxxx" >> .env.local
```

### Preview/Production

**One-time setup:**
1. Create D1 databases in the Cloudflare dashboard (one for preview, one for production)
2. Update `wrangler.toml` with the real database IDs (replacing the placeholder values)
3. Add your secrets to `.env.preview` and `.env.production`:
   ```bash
   echo "RESEND_API_KEY=re_xxxxxxxxxxxxx" >> .env.production
   echo "CLI_API_KEY=<your-generated-key>" >> .env.production
   ```
4. Deploy:
   ```bash
   npm run deploy:production
   ```

**Day-to-day:**
- **Add or update a secret** — edit the relevant `.env.<env>` file and redeploy. The deploy script compares a hash of the file and only syncs what has changed; you never need to use `wrangler secret put` manually.
- **Add a Cloudflare binding** (D1, KV, R2, …) — add it to `wrangler.toml`; it is picked up automatically at build time.

Each deploy command (`deploy:preview`, `deploy:production`) runs three steps in sequence:
1. Syncs secrets from `.env.<env>` to Cloudflare (skipped if nothing changed)
2. Builds the app with the correct environment config baked in
3. Deploys to Cloudflare — no manual `--env` flags or dashboard visits needed

### How Environment Variables Work

| Variable Type | Where Defined | Available In | Access Pattern |
|--------------|---------------|--------------|----------------|
| `VITE_*` secrets | `.env.<env-name>` | Client (React) | `import.meta.env.VITE_*` |
| Other Secrets | `.env.<env-name>` | Server (Worker) | `c.env.*` |
| Config. Settings | `wrangler.toml` | Server (Worker) | `c.env.*` |
| App Config. | `src/config.ts` | Both | `import { config }` |

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
npm run deploy:production    # Sync secrets + build + deploy to production
npm run deploy:preview       # Sync secrets + build + deploy to preview
```

Each command handles secrets, the environment-specific build, and deployment in one step. See [docs/VITE_CLOUDFLARE_BRIDGE.md](docs/VITE_CLOUDFLARE_BRIDGE.md) for how environment config is handled under the hood.

## Customization

### Branding
Update `src/config.ts` to customize your app:
```typescript
export const config = {
  appName: "My App",  // Displayed in UI, emails, page title
  email: {
    fromAddress: "onboarding@resend.dev",  // Must be verified with Resend
  },
} as const;
```

Also update prod and preview domain URLs in `.env.<env-name>.example` and `.env.<env-name>` files (or run `npm run init` to update them).

### Adding Pages
1. Create page in `src/react-app/pages/`
2. Add route in `src/react-app/App.tsx`
3. Wrap with `<ProtectedRoute>` and `<TopBar>` if auth required
4. Add navigation as appropriate for your app design

### Email Provider
Replace `createResendEmailSender` in `src/worker/middleware/auth.ts` with your provider implementing the `EmailSender` interface.

## Observability Features

### Quick Start

1. **Local Development**: Logs appear directly in Vite's terminal output when running `npm run dev`
2. **Remote Environments**: Stream real-time logs from deployed Workers:
   ```bash
   npm run tail:preview      # Stream logs from preview environment
   npm run tail:production   # Stream logs from production environment
   ```
3. **Aggregated Analytics**: Open your Worker in the Cloudflare dashboard and inspect the Metrics, Logs, and Traces panes

### Real-time Logs
The `tail` commands stream your Worker's logs (including `console.log`, `console.error`, and structured logs) from a deployed Worker. This allows you to monitor requests, errors, and custom log output as they happen.

> **Note**: `wrangler tail` only works with deployed Workers. For local development, logs appear in Vite's terminal output.

### Cloudflare Dashboard Metrics
Once deployed, use the Cloudflare dashboard to view aggregated metrics including:
- Request volumes
- Success/error rates  
- Latency measurements
- Bandwidth usage

You can also drill into individual request traces and logs for detailed analysis.

### Traces and Request Details
Cloudflare's observability features enable you to:
- Inspect individual requests
- View timing breakdowns
- See errors and stack traces produced by the Worker

### Log Export and Persistence
For long-term retention or external analysis, you can forward logs via Cloudflare Logpush or external providers (not configured by default in this template, but fully supported by Cloudflare).

## Additional Resources

### Template Internals
- [Vite ↔ Cloudflare Bridge](docs/VITE_CLOUDFLARE_BRIDGE.md) — how the project bridges Vite's dev conventions with Cloudflare's deployment model (env config baking, secrets sync, cross-platform build scripts)

### External Resources
- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Cloudflare D1](https://developers.cloudflare.com/d1/)
- [Better Auth](https://www.better-auth.com/)
- [Hono](https://hono.dev/)
- [shadcn/ui](https://ui.shadcn.com/)
- [Vite](https://vitejs.dev/)

## License

This template is open source and available under the [MIT License](LICENSE).  
It was based on the [React + Vite + Hono + Cloudflare Workers Template](https://github.com/cloudflare/templates/tree/main/vite-react-template) by Cloudflare.

(c) 2025 Claudio Silva
