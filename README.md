# Cloudflare Full-Stack Starter

[![CI](https://github.com/claudio-silva/cloudflare-fullstack-starter/actions/workflows/ci.yml/badge.svg)](https://github.com/claudio-silva/cloudflare-fullstack-starter/actions/workflows/ci.yml)

**A full-stack project starter that gets you building real features immediately** — production-ready, set up for AI agentic coding, and built to scale on Cloudflare’s global edge network.

Install and start building. Authentication, database, UI, CLI, and deployment are all ready to go.

A great starting point for your next **MVP** or **SaaS** app.

**[Live demo](https://cloudflare-fullstack-starter-production.dev-c1b.workers.dev)** — the template as it is, deployed from this repository's latest release. It is read-only: the sign-in page gives you the account, and nothing you change is saved. The **[preview demo](https://cloudflare-fullstack-starter-preview.dev-c1b.workers.dev)** shows the work in progress on `main`, unreleased.

## Contents

- [Why This Starter?](#why-this-starter)
- [Features](#features)
- [Cloudflare-first, not Cloudflare-only](#cloudflare-first-not-cloudflare-only)
- [Why Cloudflare?](#why-cloudflare)
- [AI-Assisted Development](#-ai-assisted-development)
- [AI Agent Installation, Conversion and Upgrade](#-ai-agent-installation-conversion-and-upgrade)
- [Manual Installation](#manual-installation)
- [Preview Installation](#preview-installation)
- [What's Included](#whats-included)
- [Errors, connectivity and updates](#errors-connectivity-and-updates)
  - [Error handling](#error-handling)
  - [Offline and lost connection](#offline-and-lost-connection)
  - [Automatic update of open tabs](#automatic-update-of-open-tabs)
  - [Client error reporting](#client-error-reporting)
- [Localisation (i18n)](#localisation-i18n)
- [Demo mode](#demo-mode)
- [Project Structure](#project-structure)
- [CLI Commands](#cli-commands)
  - [Auth Management](#auth-management)
  - [Database](#database)
- [Environment Setup](#environment-setup)
  - [Local Development](#local-development)
  - [Preview/Production](#previewproduction)
  - [How Environment Variables Work](#how-environment-variables-work)
- [Development](#development)
- [Deploy](#deploy)
  - [Releases and versions](#releases-and-versions)
  - [Deploy modes](#deploy-modes)
  - [Maintenance](#maintenance)
  - [Commands](#commands)
- [Customization](#customization)
- [Observability Features](#observability-features)
- [Additional Resources](#additional-resources)
- [License](#license)

---

## Why This Starter?

Cloudflare gives you remarkable power at the edge, but **it isn’t a traditional hosting platform**. Most mainstream web frameworks don’t run on Workers out of the box, and adapting them to Cloudflare’s request-driven runtime can be challenging. That early friction slows down the part you actually care about: *building something new*.

Agentic coding helps, but unfamiliar runtimes are still a weak spot. When developing for platforms like Cloudflare, **agents rarely succeed on the first attempt**. They burn cycles on:

- building boilerplate;
- fixing type and lint errors;
- debugging auth flows and smoothing out theme flicker;
- tweaking configs and juggling multi-environment setups;
- and many other small details — all the fragile infrastructure work that slows real development.

And **every new project** means **repeating the same setup steps**.

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
| **Versioned releases** | One command ships a tagged release; you always know which version is live |
| **Deploy your way** | From your machine, Cloudflare Workers Builds or your own CI, through the same pipeline |
| **Zero-downtime migrations** | Schema changes ship without taking the app down |
| **Maintenance mode** | Planned or emergency, and users don't lose what they were doing |
| **Sign-in log** | Who signed in, and who tried |
| **Global error handling** | Every API error is handled centrally — no error-handling code is needed at call sites, except when specific status codes need special handling. Standard behaviour is provided for most status codes, maintenance mode and network conditions |
| **Offline support** | While offline, requests are answered from local data by your handlers, or held and resumed in order when the connection returns; `online` / `offline` events and state |
| **Auto-update** | Open tabs learn about a new release and move to it without losing work |
| **Client error reporting** | Browser errors land in your Worker logs, with abuse protection |
| **Localisable** | Every built-in string can be translated, with or without an i18n library |
| **Demo mode** | One secret turns a deployment into a public, read-only showcase that is safe to leave online |
| **Built-in Observability** | Monitor your Worker logs, metrics, traces, performance and health |
| **CI/CD Ready** | GitHub Actions workflow validates every push: lint, type-check, tests, build and an E2E smoke test must pass.<br>You can also display the CI status badge in your README.md |
| **Testing** | Vitest integration tests running in the Workers runtime against D1 (migrations applied), plus a Playwright E2E smoke test |
| **Beautiful UI** | [shadcn/ui](https://ui.shadcn.com/) components (47 installed, the rest one command away), dark/light theme with FOUC prevention |
| **Agent skill, release log and upgrade guide** | An installable skill plus [UPGRADING.md](UPGRADING.md) (breaking changes per release, staged upgrades) so agents can install, convert and upgrade without trial and error |
| **AI-Assisted Installation and Development** | [AGENTS_SETUP.md](docs/AGENTS_SETUP.md) and [AGENTS.md](AGENTS.md) are included for easy installation and enhanced development assistance |

## Cloudflare-first, not Cloudflare-only

The starter uses a Cloudflare service wherever one fits — D1, Email Service, Durable Objects, … — because that is where the cost, simplicity and latency advantages are.

It never forces you to:

- **Services people commonly swap** sit behind small adapters (email, today).
- **Database access** goes through one connection factory ([docs/DATABASES.md](docs/DATABASES.md)).

So you can use another provider, or convert a project that already depends on one, without rewriting the app.

## Why Cloudflare?

Cloudflare's developer platform offers a unique combination that's hard to match:

- **Edge performance** — Your code runs in 300+ data centers worldwide, milliseconds from your users
- **Unified stack** — Workers, D1 database, Durable Objects, R2, KV, Email, cron triggers and more on one platform. Any binding declared under `[env.*]` in `wrangler.toml` reaches the deploy with no extra wiring
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

Leave **Include all branches** unticked (the CLI's `--include-all-branches`, off by default): the other branches are this repository's own release plumbing.

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

Better Auth signs sessions and tokens with this secret.

- **Required** in preview and production: the Worker refuses to run auth without it.
- **Optional** locally.
- Use a different value per environment:

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

**Migrations**
- **Portable** — written in TypeScript with Kysely, applied per environment with `npm run db:migrate:*`. Local development migrates automatically.
- **Baseline + incremental** — a new database gets a single baseline; an existing one gets only its pending migrations.
- **Expand / contract / breaking** — each migration declares how it relates to the running version, which decides when it runs:
  - `expand`: before the deploy;
  - `contract`: after it — and never while the live release still uses what it removes (`safeSince`);
  - `breaking`: inside a maintenance window.
- **Idempotent and journaled** — `ensureTable`, `ensureColumn`, `ensureIndex` and `ensureNoColumn` skip what is already applied, so re-running a failed migration is the recovery. `migration_journal` records what each run did (`npm run db -- journal`).
- **Safe migrate** — `--safe` takes a backup before applying anything.
- `npm run db -- new-migration <name>` scaffolds one.

**Backups**
- **Backup** — the whole database of any environment (auth tables **and** your own) to a timestamped `.backup.jsonl` file in `.wrangler/backups/`. Works on D1, PostgreSQL and MySQL.
- **Restore** — replaces the database contents from a backup file.
  - A safety backup of the current data is taken first (`--no-safety-backup` to skip; `--yes` to skip the prompt).
  - The schema must be at the same migration level as the backup.
- **Backup management** — list and clean up old backups per environment (`--dry-run`, `--all`).
- **Time Travel** — inspect or restore a remote D1 database at any earlier point, by timestamp or bookmark, with Cloudflare's built-in point-in-time restore.

**Seeds**
- Idempotent TypeScript seeds (`src/worker/db/seeds/`), run against any environment, separately from migrations.

### UI Features
- Minimalistic app shell, so that you are free to create your own design and branding
- Clean top header bar with logo and user menu
- Avatar dropdown with user info, Profile, and Sign Out
- Example admin area (`/admin`, in the avatar menu for admins): sidebar or top-bar menu, breadcrumbs, a dashboard, and user management as a CRUD example for superadmins. Restyle it, or remove it with `npm run admin:remove` ([docs/ADMIN.md](docs/ADMIN.md)) <!-- [admin-area-line] -->
- Profile page (update name, email, password; delete account)
- Dark/light theme toggle with FOUC prevention
- Theme-aware logo component (auto-switches light/dark)
- Theme can be passed via URL parameter for cross-app preference carry-over (e.g. from landing page to app)
- 47 shadcn/ui components installed, and a [catalogue](docs/SHADCN_COMPONENTS.md) of the rest with their install commands

## Errors, connectivity and updates

A client/server app goes wrong in a handful of predictable ways. The starter handles each of them **centrally, for the whole app**, so feature code deals only with what belongs to the feature.

| Situation | What the user gets | Page blocked? |
|---|---|---|
| The server refuses a request (4xx) | the server's message, as a toast | No |
| The session has expired (401) | the same, then the sign-in form | No |
| The server fails (5xx) | a generic message with a reference to quote | No |
| The connection drops | a banner counting down to the next attempt | While requests are waiting |
| A maintenance window | a banner until it ends | While requests are waiting |
| A new version is released | a dialog, then a countdown banner | No — unless it is a new major |

The Worker and the browser share one contract (`src/shared/http-contract.ts`). The reasoning behind every choice below is in [docs/MECHANISMS.md — The HTTP layer](docs/MECHANISMS.md#the-http-layer).

### Error handling

**On the server: one error shape**

- Every error response is `{ error, code, level, requestId }`.
- `error` is written for the user. The real cause goes only to the logs.
- Handlers give both at once with `AppError` or `fail()` (`src/worker/lib/errors.ts`):

  ```ts
  throw new AppError(403, "You can't edit someone else's post.", {
    log: `user ${user.id} tried to edit post ${post.id}`,
    code: "post_not_owned",
  });
  ```

- Anything else thrown — a bug — becomes a generic 500. Its cause is logged, and shown in the browser outside production.

**In the browser: no error handling at call sites**

The app calls its API with `http()` (`import { http } from "@/lib/http"`), a drop-in for `fetch`. When a call fails, the HTTP layer:

1. shows the message, as a toast;
2. on a 401, brings up sign-in;
3. **rejects** the call with `HandledHttpError`.

So the code after `await http()` runs only on success, and a call site cannot carry on as if a failed call had worked:

```ts
await http("/api/posts", { method: "POST", body });
navigate("/posts"); // not reached if the post was refused
```

**Handling a status yourself**

List it in `handles`, and the call gets it as an ordinary response:

```ts
const res = await http(`/api/posts/${id}`, { handles: [404] });
if (res.status === 404) return showEmptyState();
```

| `handles` | The call gets | The layer handles |
|---|---|---|
| `[]` (the `http()` default) | successes only | everything else |
| `[404, 409]` | those statuses too | the rest |
| `[0]` | network failures, as `fetch` gives them | the rest; nothing is held |
| `"all"` | everything | nothing, not even maintenance |
| absent or `null` | every status | lost connections and maintenance only |

**Code that does not know about the layer**

`installHttpLayer()` patches the browser's global `fetch`, so it sees every request, those of libraries included. It draws one line:

- **Statuses** are handled only for `/api/` calls that carry a `handles` key, which `http()` adds. A plain `fetch` gets every status exactly as it would without the layer, so libraries such as Better Auth's client keep working.
- **Lost connections and maintenance** are ridden out for every same-origin request, since waiting is safe for any caller.

**Your own UI, if you prefer**

- `installHttpLayer({ ui })` turns off any of the banners, the update dialog and the error toasts, so you can show your own from the same state and actions.
- `ui.blockWith` chooses how a blocked page is shown: `"banner"` (default) or `"dialog"`.

### Offline and lost connection

When the server cannot be reached, requests **wait instead of failing**, and go out in order once it can.

**What takes the app offline**

- A network failure, or a gateway error from Cloudflare's edge (502, 503, 504, 52x).
- The browser's own `offline` event, at once.

**What happens to requests**

- Each is first offered to the app's **offline handlers** (`http.addOfflineHandler`), which can answer it from local data — IndexedDB, localStorage. Their answers are marked `X-Offline: 1`.
- Those no handler answers wait in line, **without being sent**.
- Only the oldest is retried. As soon as it gets through, the rest follow in the order they were made, with nothing for the user to repeat or confirm.
- Writes carry an `Idempotency-Key` that stays the same across retries, so the server can tell a retry from a new request.

**What the user sees**

- **While requests are waiting**, the page is blocked — dimmed, no clicks, no typing — under a banner that counts down to the next attempt, with *Try now* and *Cancel*. With `blockWith: "dialog"`, a dialog in the middle instead.
- **Offline, with everything answered locally**, only the banner shows. The app stays usable.

**What the app can use**

| API | What it is for |
|---|---|
| `http.online`, `http.state` | the current state: `online`, `reconnecting`, `offline` or `maintenance` |
| `http.subscribe(listener)` | to follow it, e.g. for an indicator of your own |
| window events `app:online`, `app:offline`, `app:maintenance` | to sync local data; `app:online` fires only once everything held has been answered |
| `http.beforeReconnect(hook)` | to run something before the held requests go out, such as sending an outbox |

**Maintenance windows** are held the same way: the page is blocked under a banner of their own, and the requests are replayed when the window ends.

→ [Lost connection](docs/MECHANISMS.md#lost-connection), [Maintenance mode](docs/MECHANISMS.md#maintenance-mode)

### Automatic update of open tabs

Every response carries the server's version (`X-App-Version`). When it differs from the version of an open tab, the tab updates. How urgently depends on the version number:

| New version | Update | What the user gets |
|---|---|---|
| Same major — a minor, a patch, or a rollback within the major | **Soft** | a dialog with *Update now* and *Postpone* |
| Another major, either way — before 1.0.0, another minor | **Hard** | a dialog with *Update now* only |

**Soft update**

- *Update now* reloads.
- *Postpone* leaves a banner counting down to an automatic update, after `config.http.updateGraceMinutes` (10 by default). In the last minute it asks the user to save any pending changes.
- Navigating to another page in the meantime updates sooner, as a full page load: the one moment nothing typed can be lost.

**Hard update**

- The server refuses the old tab's API requests (426) before they run.
- The dialog cannot be postponed.
- So release an API change that older tabs cannot use with `npm run deploy:production -- --major` — and only such changes.

**Tabs that make no requests**

- A tab returning from the background checks the version once.
- A lazily loaded chunk that no longer exists reloads the page.

→ [New versions](docs/MECHANISMS.md#new-versions)

### Client error reporting

So that you see the failures your users see, next to the server's.

- **What:** uncaught errors, unhandled rejections, stale chunks, and 5xx responses in the browser.
- **Where:** posted to `POST /api/client-errors` and written to the Worker logs with `source: "client"`, the page, the client version and the browser. Nothing is stored.
- **Abuse protection:** the endpoint has to be open, since the errors that matter most can happen before sign-in. So it accepts only its own origin, caps sizes, is rate-limited per IP, and always answers 204.
- **Turning it off:** `config.http.reportClientErrors: false`.

→ [Client error reports](docs/MECHANISMS.md#client-error-reports)

## Localisation (i18n)

The starter's own user-facing strings — dialogs, banners, toasts, the messages above — are English defaults under stable keys in `src/react-app/lib/i18n.ts`, read through `t()`.

No i18n library is imposed:

- **With a library:** plug in the one your app uses with `setTranslator()`.
- **Without one:** change a few words with `overrideMessages()`.

And:

- A missing translation falls back to the English default, never to a raw key.
- Server messages can be translated on the client by their `code` (key `error.<code>`).

→ [Localising](docs/MECHANISMS.md#localising)

## Demo mode

Setting the `DEMO_MODE` secret on a deployed Worker turns it into a public showcase — the [live demo](https://cloudflare-fullstack-starter-production.dev-c1b.workers.dev) runs this way:

- **Read-only:** every write under `/api/` is refused with a message the UI shows, except signing in and out. Nobody can change the demo account, sign up, or store anything, so the data never needs resetting.
- **No email:** the email adapter becomes a no-op, so the app can never be used to send mail.
- **The account is offered on the sign-in page** (`DEMO_EMAIL` / `DEMO_PASSWORD`), and sign-in attempts are rate-limited per IP.

Everything that makes a deployment a demo lives on that deployment (Worker secrets, build variables), never in the repository. A project created from the template is not a demo, and has nothing to switch off. → [Demo mode](docs/MECHANISMS.md#demo-mode)

## Project Structure

```
├── src/
│   ├── react-app/           # React frontend
│   │   ├── admin/           # Example admin area (docs/ADMIN.md)
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
│       ├── middleware/      # Auth and maintenance middleware
│       ├── routes/          # One module per feature, mounted with app.route()
│       ├── db/              # createDb(), portable migrations (baseline + incremental), seeds
│       ├── utils/           # Email sender and templates
│       ├── scheduled.ts     # Cron handler (sign-in log pruning)
│       └── index.ts         # Mounts routes
├── src/cli/                 # CLI commands (auth user management, db utilities)
├── bin/                     # CLI entry points (init, auth, db, deploy, maintenance)
├── test/                    # Vitest worker integration tests
├── e2e/                     # Playwright smoke tests
├── wrangler.toml            # Cloudflare config
├── deploy.config.ts         # Deploy mode, branches, maintenance mechanism
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
# Both ask for confirmation; pass --yes in scripts and CI (without a terminal they refuse and exit 1)
```

User roles, each including the ones before it:

- `user` (default): standard account with no special privileges.
- `admin`: administrator. The last admin (or superadmin) cannot be demoted.
- `superadmin`: above admin.

Additional roles can be added in `src/shared/roles.ts`; check them with `hasRole()` in the browser and `requireRole()` in the Worker.
In the example admin area, admins open it and superadmins also manage users: see [docs/ADMIN.md](docs/ADMIN.md). <!-- [admin-area-line] -->

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

**One-time setup, the fast way** — on GitHub, with the project's own repository as `origin` and `main` pushed:

```bash
npm run setup:ci
```

It creates the D1 databases, fills `.env.preview` / `.env.production` (generated secrets, `workers.dev` URLs), deploys each environment for the first time, connects Cloudflare Workers Builds, syncs build variables and secrets, and protects the release branch. Safe to run again; `--dry-run` shows the plan. From then on, a push to the preview branch updates preview and `npm run deploy:production` releases through CI. It needs a user API token in `.env.setup.local`, and once per account a click in the dashboard, which it explains. → [Setting it up](docs/DEPLOYMENT.md#setting-it-up-npm-run-setupci)

Before going live, set up email: onboard your sender domain in Cloudflare Email Service (default) or configure another provider ([docs/EMAIL.md](docs/EMAIL.md)), and make `config.email.fromAddress` match the `allowed_sender_addresses` in `wrangler.toml` (`npm run init` does it).

**One-time setup, by hand** — deploying from your machine, without CI:
1. Create D1 databases in the Cloudflare dashboard (one for preview, one for production)
2. Set up email, as above
3. Update `wrangler.toml` with the real database IDs (replacing the placeholder values)
4. Add your secrets to `.env.preview` and `.env.production`:
   ```bash
   echo "CLI_API_KEY=<your-generated-key>" >> .env.production
   echo "BETTER_AUTH_SECRET=<another-generated-key>" >> .env.production
   ```
5. Deploy. The first deploy of an environment creates its Worker, then runs every migration:
   ```bash
   npm run deploy:production
   ```

**Day-to-day:**
- **Add or update a secret** — edit the relevant `.env.<env>` file and run `npm run sync-secrets -- <env>`. Only what changed is synced; you never need `wrangler secret put`.
- **Add a Cloudflare binding** (D1, KV, R2, …) — add it under `[env.*]` in `wrangler.toml` and it reaches the deploy on its own. Nothing to mirror anywhere.

**What a deploy does** — on your machine or in CI, the same script either way:

```
maintenance on   (only when a pending migration is `breaking`)
  build
  migrate expand     ← before the deploy: old code ignores new columns
  wrangler deploy
  migrate contract   ← after it: new code no longer uses them
maintenance off
```

- Each migration declares whether it is `expand`, `contract` or `breaking`, and that decides the order: a single fixed order cannot be right for both directions.
- Almost every schema change is additive (`expand`) and needs no maintenance window at all.

**Where to read more**

- [Deploy](#deploy), below — releases, deploy modes and maintenance, in summary.
- **[docs/MECHANISMS.md](docs/MECHANISMS.md) — the one to read.** What this starter gives you and why each piece is the way it is: migrations that do not take the app down, maintenance mode, versioning, secrets, the sign-in log, database portability.
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — the mechanics of deploying.

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

Releases, deploy modes, migrations and maintenance are summarised here; the reasoning is in [docs/MECHANISMS.md](docs/MECHANISMS.md) and the mechanics in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

### Releases and versions

`npm run deploy:production` cuts a release:

1. checks that CI passed on `main` (GitHub Actions, through `gh`), waiting while it runs;
2. bumps `version` in `package.json`;
3. commits `Release vX.Y.Z` and tags it;
4. deploys.

**Which version it releases**

- A new project starts at **`0.0.1`** (pre-alpha). Its first release is that version, unbumped.
- After that, each release bumps the latest tag: a patch by default, or `--minor`, `--major`, `-v X.Y.Z`.
- A version you set by hand in `package.json`, higher than the latest tag, is released as it is.

**Choosing the bump** — by compatibility, not size. A new major (before 1.0.0, a new minor) makes every open tab reload at once; anything else lets users postpone the update. See [Automatic update of open tabs](#automatic-update-of-open-tabs).

**Where to see it** — the version and commit are baked into the build and served by `GET /api/`. Preview deploys report `X.Y.Z+preview.<sha>`.

**This repository releases itself the same way**, with `APP_VERSION_FROM=starter` so that it bumps `starter.version` and leaves `version` at the `0.0.1` your project starts from; its two demos are deployed by Workers Builds. None of that is in the template. → [The starter's own releases](docs/DEPLOYMENT.md#the-starters-own-releases)

### Deploy modes

| `mode` in `deploy.config.ts` | Who builds and deploys |
|---|---|
| `manual` (default) | Your machine, through `deploy:production` / `deploy:preview` |
| `workers-builds` | Cloudflare Workers Builds, connected to your GitHub or GitLab.com repo |
| `external-ci` | Your own CI (self-hosted GitLab, GitHub Actions, …), triggered by the release tag |

- **`npm run setup:ci`** sets up `workers-builds` on GitHub in one command.
- **In the CI modes**, `deploy:production` waits for CI on the release commit, pushes the tag, promotes the deployment branch and waits for the Worker to report the new version. Protect the deployment branch with required checks to make CI a hard gate.
- **`--local`** deploys from your machine, whatever the mode.
- **To switch CI deploys off for a while** — a runner that is down, a frozen period — set the mode to `manual` and commit. Each CI deploy job then stops at its first step, green, without installing or building.

### Maintenance

| | Planned | Emergency |
|---|---|---|
| Mechanism | `MAINTENANCE` Worker var | Zone-level Single Redirect |
| Turned on by | The deploy, around a `breaking` migration | `npm run maintenance -- on --env production` |
| Users see | A 503 in place (page that reloads itself, or JSON) | Your maintenance page, at its own URL |
| Works if the Worker is broken | No | Yes |

In both cases the open app does not fail: its requests are held, a banner tells the user to wait, and the requests are replayed when the app answers again. See [Offline and lost connection](#offline-and-lost-connection).

### Commands

```bash
npm run deploy:production    # Versioned release (patch; --minor/--major); --local to build here
npm run deploy:preview       # Build, migrate and deploy preview
npm run setup:ci             # Connect Workers Builds (both envs, idempotent; --dry-run)
npm run maintenance -- status --env production   # on | off | status
npm run db -- logins --env production            # who has signed in, and how many
```

Each deploy command handles secrets, the environment-specific build, deployment and database migrations in one step.

- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — versions, migrations, deploy modes, maintenance, CI.
- [docs/VITE_CLOUDFLARE_BRIDGE.md](docs/VITE_CLOUDFLARE_BRIDGE.md) — how environment config is handled under the hood.

## Customization

### Branding
Update `src/config.ts` to customize your app:
```typescript
export const config = {
  appName: "My App",  // Displayed in UI, emails, page title
  email: {
    provider: "cloudflare",
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
Email goes through an adapter, chosen by `config.email.provider` in `src/config.ts`.

- **Default: Cloudflare Email Service**, through the `EMAIL` (`send_email`) binding declared in `wrangler.toml`. No API key needed.
- **Sender address:** `npm run init` derives one from your domain — `--app-domain https://app.myapp.com` gives `noreply@myapp.com` — and writes it to both `src/config.ts` and the binding's allow-lists.
- **Other providers** plug in by implementing one small interface.

[docs/EMAIL.md](docs/EMAIL.md) covers domain onboarding, switching providers, adding adapters and the optional inbound handler.

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
- [What this starter gives you, and why](docs/MECHANISMS.md) — migrations, maintenance mode, versioning, deploy modes, secrets, sign-in log, backups, database portability
- [Deployment, versions and migrations](docs/DEPLOYMENT.md) — what each deploy does, git-tag releases, expand/contract migrations, maintenance, Workers Builds and your own CI
- [The admin area](docs/ADMIN.md) — roles, the example backoffice, adding pages, removing it <!-- [admin-area-line] -->
- [Dependencies](docs/DEPENDENCIES.md) — why each third-party package is here, what was left out, and when to revisit
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
