# Agent Setup Guide

One-time setup instructions for AI coding agents to initialize this template.

## Node.js

Use **Node.js 22 LTS** (see `.nvmrc` at the repo root). `package.json` declares a matching `engines.node` range, and `.npmrc` sets `engine-strict=true` so installs fail fast on the wrong runtime. GitHub Actions CI uses the same minor version.

## Installing the Template

### Option 1: Into an Existing Directory (Typical IDE Workflow)

When working in an IDE like Cursor or Windsurf, you typically start with an empty project directory (possibly containing only `.cursor/`, `.git/`, or similar IDE files). Use this method:

```bash
# From the project root directory
curl -L https://github.com/claudio-silva/cloudflare-fullstack-starter/archive/refs/heads/main.tar.gz | tar xz --strip-components=1
```

This extracts the template contents directly into the current directory without creating a subdirectory.

If the directory already has a `.git` folder, keep it. Otherwise, initialize git:
```bash
git init
```

### Option 2: GitHub CLI (Creates New Repo)

If you need to create a new GitHub repository:
```bash
gh repo create my-app --template claudio-silva/cloudflare-fullstack-starter --clone
cd my-app
```

### Option 3: Git Clone (New Directory)

```bash
git clone https://github.com/claudio-silva/cloudflare-fullstack-starter.git my-app
cd my-app
rm -rf .git
git init
```

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
2. Updates `wrangler.toml` top-level worker `name`, all D1 `database_name` values (convention above), optional `[env.production] name = "<slug>-production"`, and Email sender allow-lists
3. Creates `.env.local`, `.env.preview`, `.env.production` from templates (fills in your choices; does **not** overwrite existing files)

> Migrations are **not** run by `init`. Run them manually after init (see below).

## Run Migrations

After `init`, apply the local database migrations:

```bash
npm run db:migrate
```

This creates the local D1 SQLite database and applies all migrations in `migrations/`.

## Operational scripts (database)

| Script | Purpose |
|--------|---------|
| `npm run db:migrate` | Apply migrations locally |
| `npm run db:migrate:preview` / `db:migrate:production` | Apply migrations remotely |
| `npm run db:migrate:safe` / `:preview:safe` / `:production:safe` | Backup first, then migrate |
| `npm run db:migrations:list` | List pending migration files (local) |
| `npm run db:migrations:list:preview` / `:production` | Same against remote D1 (requires `wrangler` login) |
| `npm run db:migrations:list:all` | Runs all three in sequence |
| `npm run db:backup` / `:preview` / `:production` | Export D1 to `.sql` |
| `npm run deploy:preview` / `deploy:production` | Sync secrets, bake env, deploy |

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
3. **Optional bindings** — Add `[[env.*.kv_namespaces]]`, `[[env.*.r2_buckets]]`, and `[env.*.triggers]` / `crons` in `wrangler.toml` when you need them. Anything under `[env.preview|production]` that must reach the deployed Worker must also be **baked** in `vite.config.ts` (see bridge doc); omitted keys are silently dropped from the flat `dist/<name>/wrangler.json`.
4. **Secrets** — List required keys in `.env.example`, then copy to `.env.preview` / `.env.production` (gitignored). Never commit real secrets.
5. **Order** — First deploy needs migrations applied per environment (`npm run db:migrate:preview`, etc.) once `database_id` values are real.

## CI and clone hygiene

The default GitHub Actions workflow runs `npm ci`, `npm run lint`, `npx tsc --noEmit`, and `npm run build` only. It does **not** call Cloudflare APIs, write to `wrangler.toml`, or mutate `.env.*`. Do not commit filled-in remote `database_id` values for real accounts if this checkout is a public template fork; keep placeholders until the operator wires their own IDs.

## Environment Setup

No `.env.local` file is required for basic local development beyond `CLI_API_KEY`. The app will:
- Use the local D1 database (automatically created by Wrangler)
- Auto-verify users (no email verification step)
- Work with default placeholder domains

### Optional: Enable Email
To enable real email verification locally with the default Cloudflare Email Service provider, set:
```bash
echo "AUTH_EMAILS_LOCAL_ENABLED=true" >> .env.local
```

Cloudflare Email Service uses the `SEND_EMAIL` binding in `wrangler.toml`, so no API key is required. For Resend, set `EMAIL_PROVIDER=resend` and `EMAIL_API_KEY` in the relevant `.env` file.

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
- [ ] `package.json` — Description, repository, author
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
