# Agent Setup Guide

Instructions for AI coding agents to install, convert to, or upgrade this starter. **Pick your scenario first.**

| Scenario | Go to |
|---|---|
| **A.** Empty folder, new app | [Scenario A](#scenario-a-empty-folder) |
| **B.** Folder already has files (plans, specs, docs, assets), new app | [Scenario B](#scenario-b-folder-with-existing-files) |
| **C.** Existing Node/web project to convert to Cloudflare | [CONVERT_EXISTING_PROJECT.md](CONVERT_EXISTING_PROJECT.md) |
| **D.** Project already built from this starter, update to the latest version | [UPGRADING.md](../UPGRADING.md) |

Before A or B: tell the user you propose using the starter and why (auth, D1, email, tests, multi-env deploys already working), and confirm they accept its stack choices (React 19 + Vite + Tailwind + shadcn/ui, Hono, Better Auth, D1 by default; other databases are supported, see `docs/DATABASES.md`). If the user's idea does not fit (not a React/Vite front end, heavy native dependencies, long-running servers), say so.

## Node.js

Use **Node.js 24.22.1 or later** (see `.nvmrc` at the repo root). `package.json` declares a matching `engines.node` range, and `.npmrc` sets `engine-strict=true` so installs fail fast on the wrong runtime. GitHub Actions CI uses the same major version. With nvm: `nvm install && nvm use`.

## Choosing a release

Install the **latest release tag**, not an arbitrary `main` commit, unless the user asks otherwise. `package.json` ships a `starter.version` field; keep it (the upgrade procedure in `UPGRADING.md` depends on it).

```bash
git ls-remote --tags --sort=-v:refname https://github.com/claudio-silva/cloudflare-fullstack-starter | head -3
```

## Scenario A: empty folder

The directory is empty or has only IDE/VCS files (`.git/`, `.cursor/`, `.claude/`). Extract the latest tag into it:

```bash
TAG=$(git ls-remote --tags --sort=-v:refname https://github.com/claudio-silva/cloudflare-fullstack-starter | head -1 | sed 's#.*refs/tags/##;s#\^{}##')
curl -L "https://github.com/claudio-silva/cloudflare-fullstack-starter/archive/refs/tags/$TAG.tar.gz" | tar xz --strip-components=1
```

If there is no `.git`, run `git init`. Then continue with [Non-Interactive Initialization](#non-interactive-initialization).

Alternatives: `gh repo create my-app --template claudio-silva/cloudflare-fullstack-starter --clone`, or clone into a new directory and `rm -rf .git && git init`.

## Scenario B: folder with existing files

The user already has content (a plan, specs, docs, design assets, maybe a README or `AGENTS.md`). **Never overwrite it.**

1. Read what is there first, especially any plan or spec. Note choices that conflict with the starter (framework, database, auth) and raise them with the user before proceeding.
2. Download the starter into a temporary directory, outside the project:
   ```bash
   STARTER=$(mktemp -d)
   git clone --depth 1 --branch "$TAG" https://github.com/claudio-silva/cloudflare-fullstack-starter "$STARTER"
   rm -rf "$STARTER/.git"
   ```
3. Copy only what does not exist yet: `rsync -a --ignore-existing "$STARTER"/ ./` (or equivalent). Files that already existed are untouched.
4. Merge the files that collided, by hand (list them with `diff -rq "$STARTER" . | grep "^Files"`):
   - `README.md`: keep the user's; do not import the starter's.
   - `AGENTS.md` / `CLAUDE.md`: keep the user's content and append the starter's `AGENTS.md` under a heading such as `# Starter architecture & conventions`.
   - `.gitignore`: append missing lines.
   - `package.json`: if the user has none, take the starter's. If they do, merge dependencies/scripts and keep the `starter` field.
   - `docs/`: starter docs and user docs coexist; rename on name collisions.
5. Continue with [Non-Interactive Initialization](#non-interactive-initialization), then reconcile the user's plan with the installed structure (routes in `src/worker/routes/`, pages in `src/react-app/pages/`, migrations in `migrations/`).

## D1 naming convention

After `npm run init`, these stay aligned automatically:

- Top-level `name` in `wrangler.toml` is the **project slug** (same as `package.json` `name`).
- **Local** and **production** remote D1 share the same logical `database_name`: `{slug}` (two different `database_id` values in `wrangler.toml`).
- **Preview** remote D1 uses `database_name`: `{slug}-preview`.

`bin/init.ts` rewrites every `database_name` under `[[d1_databases]]`, `[[env.preview.d1_databases]]`, and `[[env.production.d1_databases]]` from that convention — not from hardcoded template strings. Migration helper scripts read `wrangler.toml`, so they keep working after a rename.

## Non-Interactive Initialization

The init script supports CLI arguments for non-interactive use:

```bash
# Install dependencies first
npm install

# Initialize with all options (non-interactive)
./bin/init --name my-app \
  --app-domain https://app.my-app.com \
  --preview-domain https://preview.my-app.com
```

### What Init Does
1. Sets `package.json` `name` to the new slug
2. Updates `wrangler.toml` top-level worker `name`, all D1 `database_name` values (convention above), optional `[env.production] name = "<slug>-production"`, and email sender allow-lists
3. Creates `.env.local`, `.env.preview`, `.env.production` from templates (fills in your choices; does **not** overwrite existing files)
4. Removes starter-distribution files that a project does not need (`skills/`, `.claude-plugin/`)

> Migrations are **not** run by `init`. Run them manually after init (see below).

## Run Migrations

Local development needs no migrate step: the dev server creates and migrates the local database on its first API request. To migrate explicitly (local with the dev server running, or preview/production after deploying):

```bash
npm run db:migrate
```

New databases get the baseline in one step; existing ones the pending incremental migrations (`src/worker/db/migrations/`). See `docs/DATABASES.md`. `deploy:preview` and `deploy:production` run them for you after every deploy (`docs/DEPLOYMENT.md`).

## Operational scripts (database)

| Script | Purpose |
|--------|---------|
| `npm run db:migrate` | Apply migrations (through the running Worker) |
| `npm run db:migrate:preview` / `db:migrate:production` | Apply migrations remotely |
| `npm run db:migrate:safe` / `:preview:safe` / `:production:safe` | Backup first, then migrate |
| `npm run db:migrations:list` | Show applied/pending migrations (local) |
| `npm run db:migrations:list:preview` / `:production` | Same against remote D1 (requires `wrangler` login) |
| `npm run db:migrations:list:all` | Runs all three in sequence |
| `npm run db:backup` / `:preview` / `:production` | Back up the whole database to `.backup.jsonl` (any supported DB) |
| `npm run deploy:preview` / `deploy:production` | Sync secrets and build variables, bake env, deploy, migrate (production also tags a release) |
| `npm run sync-build-vars -- <env>` | Push `VITE_*` / `CLI_API_URL*` (and `CLI_API_KEY` as a secret) to Workers Builds |

## Set Up `CLI_API_KEY`

The auth CLI (`npm run auth …`) authenticates to the worker via a shared secret. Generate a key and add it to `.env.local`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
# Append the output to .env.local:
echo "CLI_API_KEY=<paste-generated-key-here>" >> .env.local
```

> The same key must be present on the Worker. Locally, the Vite plugin loads `.env.local` automatically. For remote environments (preview/production), the deploy scripts sync it from the corresponding `.env.*` file.

## Cloudflare account checklist (preview / production)

Use this when moving from local dev to real Cloudflare resources. Paths are relative to the repo root.

1. **Zones / routes** — If you use `routes` under `[env.preview]` / `[env.production]` in `wrangler.toml`, attach the hostname in the Cloudflare dashboard and keep patterns in sync with docs in `docs/VITE_CLOUDFLARE_BRIDGE.md`.
2. **D1** — Create preview and production databases in the dashboard (or CLI). Paste `database_id` into `wrangler.toml`; keep `database_name` following the convention above.
3. **Optional bindings** — Add `[[env.*.kv_namespaces]]`, `[[env.*.r2_buckets]]`, `[env.*.triggers]` / `crons` or any other binding under `[env.preview|production]` in `wrangler.toml` when you need them. `vite.config.ts` copies every key across generically, so there is nothing to mirror by hand (see bridge doc).
4. **Secrets** — List required keys in `.env.example`, then copy to `.env.preview` / `.env.production` (gitignored). Never commit real secrets.
5. **Order** — Once the `database_id` values are real, the first `npm run deploy:preview` / `deploy:production` deploys the Worker and then applies the migrations by itself (they run through the deployed Worker, so `CLI_API_KEY` and `CLI_API_URL_<ENV>` must be set in the `.env.*` file).
6. **Workers Builds (optional)** — To build and deploy on `git push`, see `docs/DEPLOYMENT.md`; it needs a user API token in `.env.setup.local` for `npm run sync-build-vars`.

## CI and clone hygiene

The default GitHub Actions workflow runs `npm ci`, lint, type check, Vitest tests and the build, plus a separate Playwright smoke job. It does **not** call Cloudflare APIs, write to `wrangler.toml`, or mutate `.env.*`. Do not commit filled-in remote `database_id` values for real accounts if this checkout is a public template fork; keep placeholders until the operator wires their own IDs.

## Environment Setup

No `.env.local` file is required for basic local development beyond `CLI_API_KEY`. The app will:
- Use the local D1 database (automatically created by Wrangler)
- Auto-verify users (no email verification step)
- Work with default placeholder domains

### Optional: Enable Email
To enable real email verification locally, set:
```bash
echo "AUTH_EMAILS_LOCAL_ENABLED=true" >> .env.local
```

The default email adapter (Cloudflare Email Service) uses the `EMAIL` binding in `wrangler.toml`, so no API key is required. To use another provider, see `docs/EMAIL.md`.

For preview/production, also set `BETTER_AUTH_SECRET` (a random 32-byte value, different per environment) in `.env.preview` / `.env.production`; the Worker refuses to run auth without it.

## Verify Setup

```bash
# Start dev server (required for local CLI operations)
npm run dev

# In another terminal, create a regular user
npm run auth create-user -- -u user@example.com -p password123

# Create an admin user
npm run auth create-user -- -u admin@example.com -p password123 -r admin

# List users to confirm
npm run auth list-users
```

Visit http://localhost:5173 and log in with the test credentials.

## User Roles

The template ships with two built-in roles:

| Role | Description |
|------|-------------|
| `user` | Default. Standard account with no special privileges. |
| `admin` | Full management access. The last admin cannot be demoted. |

Developers can add more roles by extending the migration and the worker validation in `src/worker/index.ts`.

```bash
# Assign a role at creation time
npm run auth create-user -- -u admin@example.com -p pass -r admin

# Change an existing user's role
npm run auth set-role -- -u user@example.com -r admin

# Or via edit-user
npm run auth edit-user -- -u user@example.com -r admin
```

When a user is demoted back to `user`, their active sessions are revoked immediately.

## Project Customization Checklist

After init, consider updating:

- [ ] `src/config.ts` — App name and email settings (updates UI, emails, page title)
- [ ] `README.md` — Project description and name
- [ ] `package.json` — Description, repository, author (keep the `starter` field)
- [ ] `.env.example` — Update example domains

## Troubleshooting

### Migration Fails
```bash
# Run migrations manually after init
npm run db:migrate

# If it still fails, verify wrangler.toml has [[d1_databases]] with database_id "local" for Miniflare.
```

### Port Already in Use
```bash
# Kill process on port 5173
lsof -ti:5173 | xargs kill -9

# Or use different port
npm run dev -- --port 3000
```

### TypeScript Errors After Init
```bash
# Regenerate Cloudflare types
npm run cf-typegen
```

## Next Steps

After setup, see `AGENTS.md` for:
- Project architecture
- Key patterns
- Common development tasks

---

*This file is for one-time setup. See `AGENTS.md` for ongoing development guidance.*
