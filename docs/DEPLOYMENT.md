# Deployment, versions and migrations

How a change gets from your machine to Cloudflare: what each deploy command does, how releases are versioned, how database migrations run on every deploy, and how to move the same flow to **Cloudflare Workers Builds** (build + deploy on `git push`). For the Vite ↔ wrangler config baking see [VITE_CLOUDFLARE_BRIDGE.md](VITE_CLOUDFLARE_BRIDGE.md).

## What a deploy does

| Command | Steps |
|---|---|
| `npm run deploy:preview` | sync secrets → sync build variables → build (`--mode preview`) → `wrangler deploy` → **migrate** |
| `npm run deploy:production` | `bin/deploy-production`: version bump + commit → sync secrets → sync build variables → build (`--mode production`) → `wrangler deploy` → tag + push → **migrate** |

Both always run the database migrations (when there are any), in every environment. Raw `wrangler deploy` is never used for preview/production: the build output already targets the right environment, and the scripts keep secrets, version and migrations in step.

**Migrations run after the deploy**, because they execute inside the deployed Worker (`POST /api/cli/migrate`, protected by `CLI_API_KEY`), which is what makes them work on D1, PostgreSQL and MySQL alike. `db migrate --wait-for-deploy` first polls `GET /api/` until the Worker reports this checkout's version and commit, so a still-propagating old Worker can never answer "nothing to apply" to a migration it does not know. With `--safe` it records a recovery point first (a D1 Time Travel bookmark, plus a full backup file outside CI), and it does nothing, and writes nothing, when no migration is pending.

### Writing migrations for this order

The new code is live for a short while before the schema changes (and stays live if a migration fails). So every migration must be **additive and backward-compatible**: add tables/columns (nullable or with defaults), deploy, and only drop or rename in a *later* release once no running code reads the old shape. Never edit a migration that has been applied anywhere.

If a migration fails, the deploy command exits non-zero, the new code stays live, and you fix the migration and run `npm run db:migrate:<env>:safe`. To undo a bad one on D1, restore the Time Travel bookmark printed before the migration (`npm run db -- time-travel restore --env <env> --bookmark <id>`); restoring discards every write made since, so only do it with the app quiet.

## Deployment configuration (`deploy.config.ts`)

`deploy.config.ts` at the repository root holds the shape of the pipeline, and is **committed on purpose**. How a project reaches production is a decision of the project, not of whoever happens to be deploying: if one developer had `manual` and another `workers-builds`, the same command would do two different things. Secrets stay in `.env.*`. Every value can still be overridden per environment with a `DEPLOY_*` key in `.env.<environment>`.

| Key | Meaning |
|---|---|
| `mode` | `manual` (no CI, deploy from your machine — the default), `workers-builds` (Cloudflare Workers Builds, GitHub or GitLab.com), `external-ci` (any other CI, including self-hosted GitLab) |
| `branches` | Branch each environment deploys from |
| `maintenance` | See below |
| `notifyEmail` | Address that receives a report when a deploy fails |

## Taking the app out of service

```bash
npm run maintenance -- status --env production
npm run maintenance -- on     --env production
npm run maintenance -- off    --env production
```

Deploys do this on their own for a `breaking` migration. You run it by hand for an incident.

Both mechanisms live at the **zone** level, outside the Worker, and that is the point: an in-app flag needs the Worker healthy enough to read it and render a page, which is exactly what you cannot count on during an incident. It also costs nothing per request, since there is no storage read in the hot path.

| `maintenance.mechanism` | Zone plan | Response |
|---|---|---|
| `redirect` | **any, including Free** | 302 to `maintenance.redirectTo`, a page you host outside this Worker |
| `snippet` | **Pro or above** | a real 503 with `Retry-After`, served by a Snippet |
| `none` | — | disabled; required for `*.workers.dev`, which is not part of a zone |

Snippets are the semantically correct answer — a 503 tells crawlers and monitoring the outage is temporary, which a 302 does not — but they are not available on Free zones. A WAF block rule cannot stand in: its custom response is limited to status codes 400–499. Note that the **Workers** plan is a different subscription from the **zone** plan; Workers Paid does not grant Snippets.

`maintenance.bypassPaths` (default `/api/cli/`) stays reachable while the app is down, so migrations and failure reports still work inside a maintenance window. Removing it means a window you cannot deploy inside of.

The rule is created once and then toggled, and rules you own in the same ruleset are left untouched: ours is recognised by its description. `hostname` defaults to the first route declared under `[env.<name>]` in `wrangler.toml`, so there is one source of truth.

The API token needs **zone**-level rule permissions (*Zone → Config: Edit* for redirects; Snippets additionally need snippet write access). This is a different token from the Workers-scoped one `bin/init` creates — with that one, every call fails with `Authentication error`.

## Versions and releases

The release version is the `version` in `package.json` on `main`. It is baked into the build (`vite.config.ts` → `src/shared/app-version.ts`), served by `GET /api/` as `version` and `commit`, and available to React and the Worker:

```ts
import { APP_VERSION, APP_COMMIT } from "../../shared/app-version"; // adjust the path
```

`npm run deploy:production` (`bin/deploy-production`) cuts a release from a clean, pushed `main`:

1. Picks the next version from the latest `vX.Y.Z` git tag: **patch** by default, `--minor` / `--major`, or an exact `--version vX.Y.Z`. The first release is `v1.0.0`.
2. Commits the bump (`Release vX.Y.Z`), deploys, and only then pushes `main` and the annotated tag. A failed build or deploy leaves no commit or tag behind.
3. If `HEAD` already carries a tag, that version is simply redeployed.

A project begins its own tag line: create it from the template without the starter's git history (as `docs/AGENTS_SETUP.md` does), because the starter repo's own `vX.Y.Z` tags are *template* releases and would otherwise seed the first version. `--dry-run` shows the plan, `--yes` skips the prompt, `--release-only` bumps, tags and pushes without deploying (for Workers Builds, below). **Never run it against production without the owner's approval.**

The version comes from the committed `package.json`, not from git tags, so any builder (this script or Workers Builds) produces the same value; the tag only marks the commit that carries it.

## Build variables

Local builds read `.env.<env>`; a CI build has no such file. `npm run sync-build-vars -- <env>` (also run by the deploy commands) pushes to the Worker's Workers Builds triggers, so CI builds see the same values:

| Pushed as | Keys |
|---|---|
| Plain build variable | every `VITE_*` (public by definition: it ends up in the client bundle) and `CLI_API_URL*` |
| Secret build variable (write-only) | `CLI_API_KEY`, which CI needs to run migrations through the Worker |

Whoever holds the `.env.*` files is the source of truth: their values overwrite the cloud ones; keys missing from the file are left untouched. Everyone else just uses what was pushed. Runtime secrets still go through `bin/sync-secrets.ts` (it skips `VITE_*`).

It needs a **user API token** (not an account token) with *Workers Builds Configuration: Edit* and *Workers Scripts: Read*, plus the account id, in the process environment or in `.env.setup.local` (gitignored):

```bash
CLOUDFLARE_API_TOKEN=...
CLOUDFLARE_ACCOUNT_ID=...
```

Without a token, without a deployed Worker, or before the repository is connected in the dashboard, it prints a notice and exits 0.

## Workers Builds (CI/CD) compatibility

Everything above works unchanged when Cloudflare builds and deploys on `git push`. Per Worker (`<name>-preview`, `<name>-production`): dashboard → Workers & Pages → the Worker → Settings → Builds → connect the repository, then:

| Setting | Value |
|---|---|
| Production branch | `main` (production Worker) / your preview branch (preview Worker) |
| Build command | `npm ci && npm run build:production` (`build:preview` for the preview Worker) |
| Deploy command | `npx wrangler deploy && npm run db:migrate:production:safe -- --wait-for-deploy` (preview: the `preview` variants) |

- **Version**: tag on `main` with `bin/deploy-production --release-only`, then let CI deploy that commit. Workers Builds exposes `WORKERS_CI_COMMIT_SHA`, which the build uses for `commit`.
- **Secrets** (runtime) stay in Cloudflare; **build variables** are the ones above, pushed by `sync-build-vars`. Nobody needs the `.env.*` files just to deploy.
- **Migrations**: the step above needs `CLI_API_KEY` and `CLI_API_URL_<ENV>` in the build, which `sync-build-vars` provides. The CI disk is ephemeral, so `--safe` records only the Time Travel bookmark there (it needs a token with D1 access; without one it warns and continues).
- Concurrent builds can race on migrations; keep one production branch and let builds finish.
