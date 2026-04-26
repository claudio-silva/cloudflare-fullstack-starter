# Agent Setup Guide

One-time setup instructions for AI coding agents to initialize this template.

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

## Non-Interactive Initialization

The init script supports CLI arguments for non-interactive use:

```bash
# Install dependencies first
pnpm install
# or: npm install

# Initialize with all options (non-interactive)
./bin/init --name my-app \
  --app-domain https://app.my-app.com \
  --preview-domain https://preview.my-app.com
```

### What Init Does
1. Updates `package.json` name
2. Updates `wrangler.toml` worker and database names
3. Creates `.env.local`, `.env.preview`, `.env.production` from templates (fills in your choices; does **not** overwrite existing files)

> Migrations are **not** run by `init`. Run them manually after init (see below).

## Run Migrations

After `init`, apply the local database migrations:

```bash
pnpm db:migrate:local
```

This creates the local D1 SQLite database and applies all migrations in `migrations/`.

## Set Up `CLI_API_KEY`

The auth CLI (`pnpm auth …`) authenticates to the worker via a shared secret. Generate a key and add it to `.env.local`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
# Append the output to .env.local:
echo "CLI_API_KEY=<paste-generated-key-here>" >> .env.local
```

> The same key must be present on the Worker. Locally, the Vite plugin loads `.env.local` automatically. For remote environments (preview/production), the deploy scripts sync it from the corresponding `.env.*` file.

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
pnpm dev

# In another terminal, create a regular user
pnpm auth create-user -- -u user@example.com -p password123

# Create an admin user
pnpm auth create-user -- -u admin@example.com -p password123 -r admin

# List users to confirm
pnpm auth list-users
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
pnpm auth create-user -- -u admin@example.com -p pass -r admin

# Change an existing user's role
pnpm auth set-role -- -u user@example.com -r admin

# Or via edit-user
pnpm auth edit-user -- -u user@example.com -r admin
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
pnpm db:migrate:local

# If it still fails, verify wrangler.toml has a valid [env.local] D1 binding.
# The database_id "local" is fine for local dev.
```

### Port Already in Use
```bash
# Kill process on port 5173
lsof -ti:5173 | xargs kill -9

# Or use different port
pnpm dev -- --port 3000
```

### TypeScript Errors After Init
```bash
# Regenerate Cloudflare types
pnpm cf-typegen
```

## Next Steps

After setup, see `AGENTS.md` for:
- Project architecture
- Key patterns
- Common development tasks

---

*This file is for one-time setup. See `AGENTS.md` for ongoing development guidance.*
