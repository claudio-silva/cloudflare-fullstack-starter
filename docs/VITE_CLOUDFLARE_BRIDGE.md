# Vite ↔ Cloudflare Bridge

This document explains how the project bridges the gap between Vite's development conventions and Cloudflare Workers' deployment model — so you can work with familiar tools and standards while deploying reliably to Cloudflare's global network.

---

## The challenge

Cloudflare Workers have their own configuration model (`wrangler.toml`, `wrangler secret put`, per-environment `[env.*]` sections) that doesn't map directly to Vite's conventions (`.env.<mode>` files, `--mode`, `import.meta.env`). Naïvely combining the two creates a number of friction points:

- Secrets live in two places: `.env.*` files for local development, Cloudflare's secrets store for deployed environments.
- The Cloudflare Vite plugin generates a **flat** `wrangler.json` during the build — it contains no `[env.*]` sections, so passing `--env preview` to `wrangler deploy` has no effect on it; deployments silently fall back to the base (local) config.
- Inline environment variable prefixes like `CLOUDFLARE_ENV=value cmd` work on Unix but break on Windows, where npm/pnpm delegate shell execution to `cmd.exe`.

This project solves all of these problems so you never have to think about them.

---

## What `@cloudflare/vite-plugin` does

The `@cloudflare/vite-plugin` package unifies the frontend and backend into a single Vite dev server:

- Your React frontend is served by Vite at `http://localhost:5173`.
- Your Hono API backend runs in a Cloudflare Workers runtime emulator within the same process.
- Hot Module Replacement (HMR) works for both.
- D1, KV, and other Cloudflare bindings are available locally through the emulator.

When `vite build` runs, the plugin compiles the worker and generates two output files:

| File | Purpose |
|---|---|
| `.wrangler/deploy/config.json` | Tells `wrangler deploy` to read config from the Vite build output |
| `dist/<name>/wrangler.json` | The actual wrangler config used for deployment (flat JSON, no `[env.*]` sections) |

**The critical constraint:** because `dist/<name>/wrangler.json` is flat, any `--env preview` flag passed to `wrangler deploy` is silently ignored. The deployment always uses whatever values are in that file. Without further intervention, every deploy — regardless of target environment — would use `database_id: "local"` and `ENVIRONMENT: "local"`, causing Cloudflare to reject the deploy with error 10021.

---

## How this project solves it

### 1. Build-time environment config baking (`vite.config.ts`)

`vite.config.ts` uses the plugin's `config` customizer to inject the correct per-environment values into the generated `wrangler.json` at build time:

```
npm run build:preview     →  wrangler.json contains preview D1 database ID and ENVIRONMENT=preview
npm run build:production  →  wrangler.json contains production D1 database ID and ENVIRONMENT=production
npm run build             →  wrangler.json contains base/local config (for dev or CI validation)
```

The customizer reads the D1 database names and IDs directly from `wrangler.toml` at build time, so there is a **single source of truth** for your configuration. After `npm run init` renames your project and updates `wrangler.toml`, everything else adapts automatically — you don't need to update `vite.config.ts` manually.

**Important implementation detail:** the plugin's `config` option accepts either a partial config object or a mutating function `(cfg) => void`. The object/merge form *appends* to arrays like `d1_databases`, resulting in duplicate entries. The mutating function form *replaces* values in-place and is what this project uses to ensure correctness.

### 2. One-command deploy (`deploy:preview`, `deploy:production`)

```
npm run deploy:preview
  = sync secrets  +  build:preview  +  wrangler deploy
```

Each deploy script:
1. Syncs secrets from `.env.<env>` to Cloudflare's secrets store (see below).
2. Runs the environment-specific Vite build, baking the correct config into `wrangler.json`.
3. Runs `wrangler deploy` — no `--env` flag needed, because the build output already targets the right environment.

This makes the deployment target explicit and unambiguous. There's no way to accidentally deploy with the wrong config.

### 3. Automatic secrets sync (`bin/sync-secrets.ts`)

Cloudflare Workers access secrets via `c.env.*`, but secrets can't live in `wrangler.toml` (it's committed to version control). The solution is `.env.<env>` files, which are gitignored.

`bin/sync-secrets.ts` bridges the two worlds:

- Reads `.env.preview` or `.env.production`.
- Computes a SHA-256 hash of the file and compares it with a stored hash (in `.wrangler/secrets/`).
- If changed, calls `wrangler secret put` for each secret — only syncing what has changed, not re-uploading everything every time.
- Skips `VITE_*` variables (client-side only, not secrets) and config vars such as `ENVIRONMENT`, `EMAIL_PROVIDER`, and `AUTH_EMAILS_LOCAL_ENABLED` (already set in `wrangler.toml`).

You never have to manually run `wrangler secret put` or visit the Cloudflare dashboard to manage secrets. Just edit `.env.production` and run `npm run deploy:production`.

### 4. Vite-standard `.env.*` convention

| File | Purpose | Committed? |
|---|---|---|
| `.env.local` | Local development (loaded by Vite dev server) | No |
| `.env.preview` | Preview environment secrets | No |
| `.env.production` | Production environment secrets | No |
| `.env.*.example` | Templates with placeholder values | Yes |

This matches Vite's own `.env.*` convention, so the mental model is familiar and tooling (e.g. editor plugins, dotenv loaders) works as expected.

**In worker code**, secrets are accessed via `c.env.MY_SECRET` — they're injected at runtime by the Cloudflare Workers platform, not via `import.meta.env` (which is React/browser only).

**In CLI commands** (e.g. `npm run auth list-users production`), the `.env.<env>` file is loaded automatically before making API calls, so credentials like `CLI_ADMIN_EMAIL` are available without manually sourcing the file.

---

## The full picture: a request's journey

```
Development (npm run dev)
  Vite dev server
  ├── React frontend   ← .env.local (VITE_* vars via import.meta.env)
  └── Hono Worker      ← wrangler.toml [vars] + .env.local secrets (emulated)

Build (npm run build:production)
  tsc -b                        ← typecheck all projects (app + worker + node)
  vite build --mode production  ← vite.config.ts reads wrangler.toml,
                                   bakes production D1 ID + ENVIRONMENT into
                                   dist/<name>/wrangler.json

Deploy (npm run deploy:production)
  sync-secrets production  ← .env.production → wrangler secret put (if changed)
  build:production         ← (as above)
  wrangler deploy          ← reads dist/<name>/wrangler.json (already correct)
                              no --env flag needed
```

---

## Cross-platform compatibility

All scripts use only cross-platform syntax:

- No `VAR=value cmd` inline env var syntax (breaks on Windows with cmd.exe).
- Environment mode is passed as a Vite flag (`--mode preview`), which Vite handles uniformly across platforms.
- Secret syncing uses `tsx` (Node.js) rather than shell scripts, so it works identically on macOS, Linux, and Windows.

---

## What you need to do

### Initial setup
1. Create D1 databases in the Cloudflare dashboard for preview and production.
2. Update `database_id` entries in `wrangler.toml` with the real IDs (replacing the placeholder values).
3. Add your secrets to `.env.preview` and `.env.production`.

### Day-to-day
- **Develop** with `npm run dev` — nothing to configure.
- **Deploy** with `npm run deploy:preview` or `npm run deploy:production` — one command handles everything.
- **Add a secret** — add it to the relevant `.env.<env>` file and redeploy. The sync script handles the rest.
- **Add a D1 or email binding** — add it to `wrangler.toml`; it's picked up at build time by `vite.config.ts`.

You never need to use `wrangler secret put` manually, manage Cloudflare dashboard secrets by hand, or worry about which environment a deploy is targeting.
