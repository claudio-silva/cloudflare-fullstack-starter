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
| **Database Ready (and database-agnostic)** | [Cloudflare D1](https://developers.cloudflare.com/d1/) by default, with portable Kysely migrations (baseline for new installs + incremental for upgrades), seeds, and whole-database backup/restore (any supported database) plus D1 time-travel from the CLI. The same schema, migrations, auth and tests run on PostgreSQL and MySQL too ([docs/DATABASES.md](docs/DATABASES.md)) |
| **Multi-Environment** | Local, Preview, and Production environments with separate databases, configurations and secrets |
| **Secrets Management** | Secrets are automatically synced from `.env.<env>` files to Cloudflare (optional), no need to manually set them in the dashboard (but you still can) |
| **Complete Auth Flow** | Sign up, email verification, login, logout, profile management, powered by [Better Auth](https://www.better-auth.com/) |
| **Transactional emails** | Email verification and password reset through a swappable adapter: Cloudflare Email Service by default, other providers easy to add |
| **CLI Tools** | User management and full database tooling (migrate, backup, restore, time-travel, seed) across all environments, from your terminal |
| **Dead simple deployment** | Deploy to Cloudflare's global network with one command |
| **Built-in Observability** | Monitor your Worker logs, metrics, traces, performance and health |
| **CI/CD Ready** | GitHub Actions workflow validates every push: lint, type-check, tests, build and an E2E smoke test must pass.<br>You can also display the CI status badge in your README.md |
| **Testing** | Vitest integration tests running in the Workers runtime against D1 (migrations applied) and Durable Objects, plus a Playwright E2E smoke test |
| **Beautiful UI** | 50+ [shadcn/ui](https://ui.shadcn.com/) components, dark/light theme with FOUC prevention |
| **Agent skill, release log and upgrade guide** | An installable skill plus [UPGRADING.md](UPGRADING.md) (breaking changes per release, staged upgrades) so agents can install, convert and upgrade without trial and error |
| **AI-Assisted Installation and Development** | [AGENTS_SETUP.md](docs/AGENTS_SETUP.md) and [AGENTS.md](AGENTS.md) are included for easy installation and enhanced development assistance |

## Cloudflare-first, not Cloudflare-only

The starter uses Cloudflare services wherever one fits (D1, Email Service, Durable Objects, ...), because that is where the cost, simplicity and latency advantages are. It never forces you to: services that people commonly swap sit behind small adapters (email today), and database access goes through one connection factory ([docs/DATABASES.md](docs/DATABASES.md)), so you can use another provider, or convert a project that already depends on one, without rewriting the app.

## Why Cloudflare?

Cloudflare's developer platform offers a unique combination that's hard to match:

- **Edge performance** — Your code runs in 300+ data centers worldwide, milliseconds from your users
- **Unified stack** — Workers, D1 database, Durable Objects, Email and more on one platform (R2, KV and cron are wired into the build config in `vite.config.ts`, but no example code is included)
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

## 🤖 AI Agent Installation, Conversion and Upgrade

You can ask your coding agent to **install** the starter, **convert** an existing project to Cloudflare, or **upgrade** a project built from the starter. Install the agent skill once, so the agent proposes the starter at the right moment and follows the documented procedure instead of improvising:

```bash
# Any agent supported by the skills CLI (Claude Code, Cursor, Codex, ...)
npx skills add claudio-silva/cloudflare-fullstack-starter

# Claude Code plugin marketplace
/plugin marketplace add claudio-silva/cloudflare-fullstack-starter
/plugin install cloudflare-fullstack-starter@cloudflare-fullstack-starter
```

Then just ask, for example: *"Create this app on Cloudflare"*, *"Convert this site to Cloudflare"*, or *"Update this project to the latest starter version"*.

Without the skill, give the agent this prompt (it works for all four scenarios):

> **Prompt:** Use the Cloudflare Full-Stack Starter for this project. Read https://raw.githubusercontent.com/claudio-silva/cloudflare-fullstack-starter/main/docs/AGENTS_SETUP.md and follow the scenario that matches (new app in an empty folder, new app in a folder with existing files, convert an existing project, or upgrade an existing starter-based project).

The procedures live in the repository, so they are always current:

| Scenario | Guide |
|---|---|
| New app, empty folder, or folder with existing files | [docs/AGENTS_SETUP.md](docs/AGENTS_SETUP.md) |
| Convert an existing Node/web project | [docs/CONVERT_EXISTING_PROJECT.md](docs/CONVERT_EXISTING_PROJECT.md) |
| Upgrade a starter-based project (staged, with breaking changes per release) | [UPGRADING.md](UPGRADING.md) |

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

Requires **Node.js 24.22.1 or later** (`.nvmrc`; with nvm run `nvm install && nvm use`). 24.22.1 is the current LTS and the first release on that line carrying the October 2026 security fixes.

```bash
npm install
# or: pnpm install  (scripts are package-manager agnostic; npm is the default and the CI uses it)
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

### 5. Set `BETTER_AUTH_SECRET` (preview/production)

Better Auth signs sessions and tokens with this secret. It is **required** in preview and production (the Worker refuses to run auth without it) and optional locally. Use a different value per environment:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
# paste the output as: BETTER_AUTH_SECRET=<value>   (in .env.preview / .env.production)
```

### 6. Start development

```bash
npm run dev
```

The local database is created and migrated automatically on the first API request; there is no separate migration step for local development.

Open http://localhost:5173 — you'll see the login page. Sign up to create your first account.

## Preview Installation

**Just want a quick peek?**

Click to deploy a temporary preview to Cloudflare:

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/claudio-silva/cloudflare-fullstack-starter)

Fast path (no email confirmation needed):

1. In the wizard, keep the other defaults. When you add or bind **D1**, use these values so they match this repo’s `wrangler.toml` (copy/paste friendly):
   - **Worker name:** `cloudflare-fullstack-starter` (if the wizard asks for the script / Worker name).
   - **D1 binding name:** `DB` — this must be exactly `DB`; the Worker reads `c.env.DB`.
   - **D1 database name:** `cloudflare-fullstack-starter` — use this as the database’s **name** in the dashboard (logical name), not the binding field.
2. Deploy, then open the URL the wizard shows.
3. On the login overlay, click “Sign up”, create an account, and sign in. With the default `ENVIRONMENT=local`, email verification is skipped.

You do not need to set extra environment variables for this quick try-out.

Note that this is a **temporary preview**, so you should **discard it after testing** by deleting the Worker and the D1 DB from the Cloudflare dashboard or CLI.

#### To discard the preview

##### Via Dashboard
Workers & Pages → select the deployed worker → Settings → Delete (and delete the D1 database named `cloudflare-fullstack-starter` if you created it).

##### Via CLI
If wrangler is logged in, you can do it from the command line:

  ```bash
  npx wrangler delete cloudflare-fullstack-starter
  npx wrangler d1 delete cloudflare-fullstack-starter --yes
  ```

---

## What's Included

### Tech Stack
| Component | Technology |
|-------|------------|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS, shadcn/ui |
| Backend | Hono (Workers), Cloudflare Vite Plugin, Better Auth, Kysely |
| Database | Cloudflare D1 (SQLite) by default; other databases and provider APIs supported via a single connection seam ([docs/DATABASES.md](docs/DATABASES.md)) |
| Email | Adapter: Cloudflare Email Service (default), pluggable |
| Testing | Vitest (`@cloudflare/vitest-plugin`), Playwright |
| Deployment | Cloudflare Workers/Pages Runtime |

### Auth Features
- Email/password authentication with email verification and password reset
- Session management with secure cookies
- Protected routes with seamless authentication overlay that prevents content flashing and needless page reloads
- CLI user management (create, list, view, edit, delete, activate) for local and remote environments, with positional env shorthand (`npm run auth list-users production`)

### Database Features
- Portable migrations (TypeScript, Kysely) applied per-environment via `npm run db:migrate:*`; new databases get a single baseline, existing ones the pending incremental migrations; local dev migrates automatically
- **Safe migrate** — automatically takes a pre-migration backup before applying schema changes (`--safe`)
- **Backup** — export the whole database (auth **and** your own tables) of any environment to a timestamped `.backup.jsonl` file in `.wrangler/backups/`; works on D1, PostgreSQL and MySQL
- **Restore** — replace the database contents from a backup file; a safety backup of the current data is taken first (`--no-safety-backup` to skip, `--yes` to skip the prompt). The schema must be at the same migration level as the backup
- **Backup management** — list and clean up old backups per-environment, with `--dry-run` and `--all` options
- **Time Travel** — inspect and restore to any historical state of a remote D1 database using Cloudflare's built-in time-travel (point-in-time restore by timestamp or bookmark)
- **Seeds** — run idempotent TypeScript seeds (`src/worker/db/seeds/`) against any environment, separately from migrations

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
│       ├── routes/          # One module per feature, mounted with app.route()
│       ├── durable-objects/ # Durable Object example
│       ├── db/              # createDb(), portable migrations (baseline + incremental), seeds
│       ├── utils/           # Email sender and templates
│       └── index.ts         # Mounts routes
├── src/cli/                 # CLI commands (auth user management, db utilities)
├── bin/                     # CLI entry points (init, auth, db)
├── test/                    # Vitest worker integration tests
├── e2e/                     # Playwright smoke tests
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

# Create a new user
npm run auth create-user -- -u admin@example.com -p password123
npm run auth create-user -- -u admin@example.com -p password123 -n "Admin User"
npm run auth create-user -- -u admin@example.com -p password123 -r admin   # create as admin

# View detailed user info (includes account provider, sessions, timestamps)
npm run auth show-user -- -u admin@example.com

# Edit user details
npm run auth edit-user -- -u admin@example.com -n "New Name"
npm run auth edit-user -- -u admin@example.com -e newemail@example.com
npm run auth edit-user -- -u admin@example.com -p newpassword123
npm run auth edit-user -- -u admin@example.com -r admin    # promote to admin

# Set a user's role directly
npm run auth set-role -- -u admin@example.com -r admin
npm run auth set-role -- -u user@example.com -r user

# Activate or deactivate a user account
npm run auth activate-user -- -u admin@example.com -s on   # activate
npm run auth activate-user -- -u admin@example.com -s off  # deactivate

# Delete a user (removes user, accounts, and sessions)
npm run auth delete-user -- -u admin@example.com
npm run auth delete-user -- --all                          # delete ALL users (use with caution)
```

User roles:

- `user` (default): standard account with no special privileges.
- `admin`: full management access. The last admin cannot be demoted.

Additional roles can be added by the developer by extending the migration and the worker validation logic.

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
# Migrations (run inside the Worker; for local the dev server must be running)
npm run db:migrate
npm run db:migrate:preview
npm run db:migrate:production

# List applied/pending migrations
npm run db:migrations:list
npm run db:migrations:list:preview
npm run db:migrations:list:production
npm run db:migrations:list:all

# Safe migrate: takes a backup before applying (recommended for remote envs)
npm run db:migrate:preview:safe
npm run db:migrate:production:safe

# Backups — whole database to a .backup.jsonl file in .wrangler/backups/
npm run db:backup
npm run db:backup:preview
npm run db:backup:production
npm run db:backup:all         # all three environments at once

# List backup files
npm run db:backups
npm run db:backups:production
npm run db:backups -- --env preview --archive-dir ./.my-backups

# Clean up backup files
npm run db:backups:clean
npm run db:backups:clean -- --env local --all        # delete without prompting
npm run db:backups:clean -- --env local --dry-run    # preview what would be deleted

# Restore from backup
npm run db:restore:latest                                         # auto-picks latest, takes a safety backup of the current data first
npm run db:restore -- --env local --file my.backup.jsonl
npm run db:restore -- --env preview --file preview.backup.jsonl
npm run db:restore -- --env production --file production.backup.jsonl --yes

# Time Travel (remote envs only — requires D1 Time Travel to be enabled)
npm run db:time-travel -- --env preview time-travel info
npm run db:time-travel:info -- --env preview --timestamp "2026-04-01 12:00:00"
npm run db:time-travel:restore -- --env production --timestamp "2026-04-01 12:00:00"
npm run db:time-travel:restore -- --env production --bookmark <bookmark-id>

# Seeds — run idempotent TypeScript seeds registered in src/worker/db/seeds
npm run db:seed                                                    # auto-picks if only one is registered
npm run db:seed -- --env local --file admin-bootstrap
npm run db:seed -- --env preview --file admin-bootstrap
npm run db:seed -- --env production --file admin-bootstrap
```

> **Tip:** You can pass extra options after `--` in any `npm run db:*` shorthand, e.g. `npm run db:backup -- --archive-dir ./tmp`.

See [docs/DATABASES.md](docs/DATABASES.md) for migrations, seeds, the portability notes and how to use PostgreSQL or MySQL.

## Environment Setup

### Local Development

The app runs locally without requiring email. To test real auth emails locally with the default Cloudflare provider, enable local auth emails:
```bash
echo "AUTH_EMAILS_LOCAL_ENABLED=true" >> .env.local
```

The default Cloudflare Email Service adapter uses the `EMAIL` binding in `wrangler.toml`, so no API key is required. See [docs/EMAIL.md](docs/EMAIL.md) for domain onboarding and other providers.

### Preview/Production

**One-time setup:**
1. Create D1 databases in the Cloudflare dashboard (one for preview, one for production)
2. Set up email: onboard your sender domain in Cloudflare Email Service (default), or configure another provider (see [docs/EMAIL.md](docs/EMAIL.md))
3. Run `npm run init` or update `src/config.ts` and `wrangler.toml` so `config.email.fromAddress` matches the `allowed_sender_addresses` entries
4. Update `wrangler.toml` with the real database IDs (replacing the placeholder values)
5. Add your secrets to `.env.preview` and `.env.production`:
   ```bash
   echo "CLI_API_KEY=<your-generated-key>" >> .env.production
   echo "BETTER_AUTH_SECRET=<another-generated-key>" >> .env.production
   ```
6. Deploy:
   ```bash
   npm run deploy:production
   ```

**Day-to-day:**
- **Add or update a secret** — edit the relevant `.env.<env>` file and run `npm run sync-secrets -- <env>`. Only what changed is synced; you never need `wrangler secret put`.
- **Add a Cloudflare binding** (D1, KV, R2, …) — add it under `[env.*]` in `wrangler.toml` and it reaches the deploy on its own. Nothing to mirror anywhere.

A deploy runs this sequence, on your machine or in CI — the same script either way:

```
maintenance on   (only when a pending migration is `breaking`)
  build
  migrate expand     ← before the deploy: old code ignores new columns
  wrangler deploy
  migrate contract   ← after it: new code no longer uses them
maintenance off
```

Almost every schema change is additive and needs no window at all. Each migration declares whether it is `expand`, `contract` or `breaking`, and that is what decides the order — a single fixed order cannot be right for both directions.

`deploy:production` cuts a versioned release: it tags `vX.Y.Z` and, in a CI mode, promotes the deployment branch and waits for the Worker to report the new version. **A push to that branch with no tag deploys nothing**, so nothing ever goes online without a version attached to it.

Where the build happens is one setting in `deploy.config.ts`: `manual` (your machine), `workers-builds` (Cloudflare) or `external-ci` (GitLab, Actions, anything).

**[docs/MECHANISMS.md](docs/MECHANISMS.md) is the one to read** — what this starter gives you and why each piece is the way it is: migrations that do not take the app down, maintenance mode, versioning, secrets, the sign-in log, database portability. The mechanics of deploying are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

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
npm test             # Vitest: Worker + D1 integration tests
npm run test:e2e     # Playwright smoke test (installs: npx playwright install chromium)
npm run check        # Type check + build + deploy dry-run
```

## Deploy

```bash
npm run deploy:production    # Versioned release (patch; --minor/--major); --local to build here
npm run deploy:preview       # Build, migrate and deploy preview
npm run maintenance -- status --env production   # on | off | status
npm run db -- logins --env production            # who has signed in, and how many
```

Each command handles secrets, the environment-specific build, deployment and database migrations in one step. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) (versions, migrations, Workers Builds) and [docs/VITE_CLOUDFLARE_BRIDGE.md](docs/VITE_CLOUDFLARE_BRIDGE.md) for how environment config is handled under the hood.

## Customization

### Branding
Update `src/config.ts` to customize your app:
```typescript
export const config = {
  appName: "My App",  // Displayed in UI, emails, page title
  email: {
    defaultProvider: "cloudflare",
    fromAddress: "noreply@example.com",  // Must be allowed by the active provider
  },
} as const;
```

Also update prod and preview domain URLs in `.env.<env-name>.example` and `.env.<env-name>` files (or run `npm run init` to update them).

### Adding Pages
1. Create page in `src/react-app/pages/`
2. Add route in `src/react-app/App.tsx`
3. Wrap with `<ProtectedRoute>` and `<TopBar>` if auth required
4. Add navigation as appropriate for your app design

### Email
Email goes through an adapter chosen by `config.email.provider` in `src/config.ts`. The default is Cloudflare Email Service via the `EMAIL` (`send_email`) binding declared in `wrangler.toml`; `npm run init` derives a sender such as `noreply@myapp.com` from `--app-domain https://app.myapp.com` and updates both `src/config.ts` and the binding allow-lists. Other providers plug in by implementing one small interface. Domain onboarding, provider switching, adding adapters and the optional inbound handler are covered in [docs/EMAIL.md](docs/EMAIL.md).

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
- [Deployment, versions and migrations](docs/DEPLOYMENT.md) — what each deploy does, git-tag releases, migrations on every deploy, Workers Builds
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
