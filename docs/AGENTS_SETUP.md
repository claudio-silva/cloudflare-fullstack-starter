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

# Initialize with all options
./bin/init --name my-app \
  --app-domain https://app.my-app.com \
  --preview-domain https://preview.my-app.com

# Skip migrations if needed
./bin/init --name my-app --no-migrate
```

### What Init Does
1. Updates `package.json` name
2. Updates `wrangler.toml` worker and database names
3. Updates domain URLs in env templates
4. Runs local D1 migrations (unless `--no-migrate`)

## Environment Setup

No `.env.local` file is required for basic local development. The app will:
- Use local D1 database (automatically created by Wrangler)
- Skip email verification (users are auto-verified locally)
- Work with default placeholder domains

### Optional: Enable Email
To enable email verification locally, add your [Resend](https://resend.com/) API key to `.env.local`:
```bash
echo "RESEND_API_KEY=re_your_key_here" >> .env.local
```

The Cloudflare Vite plugin loads `.env.local` and injects secrets into the Worker environment.

## Verify Setup

```bash
# Start dev server
pnpm dev

# In another terminal, create a test user
pnpm auth create-user -u test@example.com -p password123

# Check the user was created
pnpm auth list-users
```

Visit http://localhost:5173 and log in with the test credentials.

## Project Customization Checklist

After init, consider updating:

- [ ] `src/config.ts` — App name and email settings (updates UI, emails, page title)
- [ ] `README.md` — Project description and name
- [ ] `package.json` — Description, repository, author
- [ ] `.env.example` — Update example domains

## Troubleshooting

### Migration Fails
```bash
# Ensure wrangler can create local D1
pnpm db:migrate:local

# If it fails, check wrangler.toml has valid config
# The database_id "local" is fine for local dev
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
