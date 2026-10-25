# Deployment, versions and migrations

How a change gets from your machine to Cloudflare: what a deploy does, how migrations are classified so almost all of them ship with no downtime, how releases are versioned and tagged, how to take the app out of service, and how to hand the same pipeline to CI. For the Vite ↔ wrangler config baking see [VITE_CLOUDFLARE_BRIDGE.md](VITE_CLOUDFLARE_BRIDGE.md).

## What a deploy does

```
maintenance on   (only when a pending migration is `breaking`)
  build
  migrate expand     ← before the deploy
  migrate breaking   ← inside the window
  wrangler deploy
  migrate contract   ← after the deploy
maintenance off
```

`bin/deploy-pipeline.ts` is that sequence, and both a laptop deploy and a CI deploy run it, so the two cannot drift apart. Raw `wrangler deploy` is never used for preview or production: the build output already targets the environment, and the pipeline keeps secrets, version and migrations in step.

| Command | What it does |
|---|---|
| `npm run deploy:preview` | runs the pipeline against preview |
| `npm run deploy:production` | cuts a release (version, tag, promote) and then deploys it, however `deployConfig.mode` says |
| `npm run deploy:ci` | the pipeline with `--skip-build`, for CI that already built |

Migrations execute **inside the deployed Worker** (`POST /api/cli/migrate`, protected by `CLI_API_KEY`), which is what makes one implementation work on D1, PostgreSQL and MySQL alike. `--wait-for-deploy` polls `GET /api/` until the Worker reports this checkout's version and commit, so a still-propagating old Worker cannot answer "nothing to apply" to a migration it has never heard of. `--safe` records a recovery point first — a D1 Time Travel bookmark, plus a full backup file outside CI — and the whole command does nothing, and writes nothing, when nothing is pending.

## Writing migrations: expand, contract, breaking

Every migration declares how it relates to the application version running beside it. This is the *parallel change* pattern, and it is what lets almost every schema change ship with no downtime at all.

| `compatibility` | Meaning | When it runs |
|---|---|---|
| `expand` (default) | Additive: new tables, nullable columns, columns with a default, new indexes | **Before** the deploy — the old code ignores what it does not know |
| `contract` | Removes what an earlier release stopped using | **After** the deploy — the new code no longer touches it |
| `breaking` | Cannot be made compatible with the running version | Inside a maintenance window |

A single fixed order cannot serve both directions, which is why the pipeline reads this rather than assuming one.

**Dropping a column takes two releases.** There is always a moment when the old code is still serving requests against the new schema, so the release that stops *using* a column and the migration that *drops* it cannot be the same one. Renaming `name` to `full_name`:

1. Add `full_name` nullable (`expand`); write both, read `full_name` falling back to `name`.
2. Backfill `full_name` (`expand`); read only `full_name`, still write both.
3. Stop writing `name`. No migration.
4. Drop `name` (`contract`, `safeSince: "<the version from step 3>"`).

`safeSince` is checked against the version actually live (`GET /api/`), so the pipeline refuses to run step 4 before step 3 has shipped. That turns "remember to wait a release" from discipline into something the tooling cannot get wrong.

Keep migrations **idempotent** — `ensureColumn`, `ensureIndex`, `ensureTable`, `ensureNoColumn` from `src/worker/db/migrations/ensure.ts`. MySQL and SQLite do not roll back a failed migration, so re-running it is the normal recovery, and that only works if the statements that already applied are skipped rather than repeated. Never edit a migration that has been applied anywhere.

### When a migration fails

The pipeline exits non-zero, any maintenance window **stays open on purpose**, and a report goes out by email (`config.email.deployReportsTo`).

```bash
npm run db -- journal --env production     # how far did it get?
```

The journal is the only account of a partial migration on MySQL and SQLite. On PostgreSQL it reports `rolled_back`, because Kysely wraps all pending migrations in one transaction wherever the dialect supports transactional DDL — so there is nothing to repair, just a migration to fix.

Recovery is normally **forward**: leave the state as it is, correct the migration, deploy again. Rolling back is the exception — a `DROP COLUMN` has already discarded the data, so "undo" is often not a thing that exists. On D1 you can restore the Time Travel bookmark printed before the migration (`npm run db -- time-travel restore --env <env> --bookmark <id>`), which discards every write made since, so only with the app quiet.

## Deployment configuration (`deploy.config.ts`)

`deploy.config.ts` at the repository root holds the shape of the pipeline, and is **committed on purpose**. How a project reaches production is a decision of the project, not of whoever happens to be deploying: if one developer had `manual` and another `workers-builds`, the same command would do two different things. Secrets stay in `.env.*`. Every value can still be overridden per environment with a `DEPLOY_*` key in `.env.<environment>`.

| Key | Meaning |
|---|---|
| `mode` | `manual` (no CI, deploy from your machine — the default), `workers-builds` (Cloudflare Workers Builds, GitHub or GitLab.com), `external-ci` (any other CI, including self-hosted GitLab) |
| `branches` | Branch each environment deploys from |
| `maintenance` | See below |
| `notifyEmail` | Address that receives a report when a deploy fails |

## Taking the app out of service

Two mechanisms, for two different problems. Do not reach for the wrong one.

### Planned window — the `MAINTENANCE` var

A `breaking` migration needs the app to stop while it runs. The deploy does this on its own:

```
wrangler deploy --var MAINTENANCE:1   ← app answers 503 in place
migrate
wrangler deploy                        ← var gone, app back
```

The Worker reads the var from memory, so this costs **nothing per request** — an earlier design kept the flag in storage and paid a read on every request for something that is off essentially all the time. The price is that flipping it needs a deploy, which is free here: a migration window wraps a deploy anyway.

Responses depend on what the caller asked for, so each kind of client gets something it can act on:

| `Accept` | Response |
|---|---|
| `application/json` | `503` with `{"error":"Service unavailable","code":"maintenance"}` |
| `text/html` | `503` with a page that reloads itself |
| anything else | `503`, empty body |

All carry `X-Maintenance: 1` and `Retry-After: 60`. `/api/` and `/api/cli/*` answer normally throughout: the first is what `deploy:production` polls to confirm the release, the second carries the migration the window was opened for.

**The client handles this by itself.** `src/react-app/lib/maintenance.ts` patches global `fetch`:

- the **first** request to come back with `X-Maintenance` starts a single polling loop, seeded with the server's `Retry-After`;
- every request made after that is **held without being sent** — once the app is known to be down there is no point asking it again, so only that first 503 ever costs a round trip;
- when the app answers, the held requests go out, each with its own method and payload, and the caller's promise resolves with the real response.

`<MaintenanceOverlay />` tells the user what is happening. Call sites never learn that any of it occurred.

Patching global `fetch` rather than exporting a wrapper is deliberate, for the reason Angular uses an HTTP interceptor: libraries make their own requests. Better Auth's would otherwise slip past.

### Emergency — `npm run maintenance`

For a security problem or a bad deploy, when traffic has to stop **now**:

```bash
npm run maintenance -- on     --env production
npm run maintenance -- off    --env production
npm run maintenance -- status --env production
```

A Single Redirect rule at the zone, toggled through the Cloudflare API. One call, about five seconds, and — the reason it exists — **it works when the Worker itself is what is broken or compromised**, which is exactly when an in-Worker flag cannot help.

The trade is honest: a redirect changes the URL, so the user cannot simply refresh. In an emergency that is the least of the problems.

`maintenance.mechanism` is `redirect` or `none`; `none` is required for `*.workers.dev`, which is not part of a zone. Cloudflare Snippets would give an in-place 503 at the zone level, but they need a **Pro zone**, and the `MAINTENANCE` var already covers the planned case better — a third mechanism for a rare event is where the complexity stops paying.

The API token needs the zone permission **Dynamic URL Redirects Write**. A Workers-scoped token does not have it, and every call fails with `Authentication error`.

## Versions and releases

The release version is the `version` in `package.json` on `main`. It is baked into the build (`vite.config.ts` → `src/shared/app-version.ts`) and served by `GET /api/` as `version` and `commit`:

```ts
import { APP_VERSION, APP_COMMIT } from "../../shared/app-version"; // adjust the path
```

It comes from the committed file, not from the tag, so every builder — this script, Workers Builds, GitLab CI — produces the same value. The tag only marks the commit that carries it.

**A production deploy is always started by `npm run deploy:production`, and always carries a tag.** Pushing or merging into the deployment branch without one deploys nothing. The reason is simple: a deploy triggered by a bare push puts code online with no version attached to it, and then two different builds answer to the same version number.

```bash
npm run deploy:production              # patch
npm run deploy:production -- --minor   # or --major, or -v 2.1.0
npm run deploy:production -- --dry-run # show the plan, change nothing
npm run deploy:production -- --local   # build and deploy from here, whatever the mode
npm run deploy:production -- --release-only   # bump, tag and push; deploy nothing
```

It runs from a clean `main` that equals `origin/main`. If `HEAD` already carries a tag, that version is redeployed instead of bumped. **Never run it against production without the owner's approval.**

Where the tag sits in the sequence differs by mode, and both placements are deliberate:

- **`manual`** — deploy first, tag after it succeeds. There is no trigger to arm, so a failed release should not leave a tag claiming a version that never went live.
- **`workers-builds` / `external-ci`** — tag first, then promote the branch, because the tag is what the build checks. The script then waits for `GET /api/` to report the version it released. A tag whose deploy failed stays behind; it means "handed to the pipeline", and `/api/` tells you what is actually serving.

Preview is looser on purpose: it deploys on every push to its branch with **no tag**, and reports `X.Y.Z+preview.<sha>`. That is semver build metadata, ignored when comparing versions, which is right — it is the same version line, built from a different branch. A pre-release suffix would sort *below* the release, and preview is normally ahead of production, not behind.

A project begins its own tag line: create it from the template without the starter's git history (as `docs/AGENTS_SETUP.md` does), because the starter's own `vX.Y.Z` tags are *template* releases and would otherwise seed the first version.

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

## Running it in CI

`deployConfig.mode` picks who builds. All three run the same pipeline.

### `manual`

No CI. `npm run deploy:production` does everything from your machine. The default, and perfectly sound for a small project.

### `workers-builds` — Cloudflare Workers Builds

GitHub or GitLab.com only; **self-hosted GitHub or GitLab is not supported** — use `external-ci` there. Per Worker: dashboard → Workers & Pages → the Worker → Settings → Builds → connect the repository.

| Setting | Value |
|---|---|
| Build command | `npm ci && npm run build:production` — add `&& npm run lint && npx tsc -b && npm test` if you want CI to gate on tests |
| Deploy command | `npm run deploy:ci -- --env production` |
| Branch | the deployment branch (`release` by default) |

Workers Builds triggers on **branch pushes, never on tags**, so leave automatic branch builds disabled and put the **deploy hook** URL in `.env.production` as `DEPLOY_HOOK_URL`. `deploy:production` posts to it after pushing the tag, which keeps "no deploy without a tag" true.

The build command is an ordinary shell command: if it exits non-zero the build fails and the deploy step never runs. So CI *can* gate on tests. What it cannot do is run service containers or browsers, so a Postgres/MySQL matrix and Playwright stay in GitHub Actions.

### `external-ci` — your own CI

Anything else, including self-hosted GitLab. Trigger the pipeline on tags and run:

```yaml
deploy:production:
  rules:
    - if: $CI_COMMIT_TAG =~ /^v\d+\.\d+\.\d+$/
  script:
    - npm ci
    - npm run build:production
    - npm run deploy:ci -- --env production
```

Mark the Cloudflare token as a **protected** CI variable and protect the deployment branch, so a token for production is never exposed to a pipeline running on some other branch.

### What CI needs, and what it does not

- **Runtime secrets** stay on the Worker. CI never syncs them — a developer does, with `npm run sync-secrets`. `deploy:production` reminds you when `.env.production` exists and the mode is not `manual`.
- **Build variables** are the ones above. In `workers-builds` they come from `sync-build-vars`; in `external-ci` they are your CI's variables.
- **Migrations** need `CLI_API_KEY` and `CLI_API_URL_<ENV>` in the build.
- The CI disk is ephemeral, so `--safe` records only the Time Travel bookmark there. That needs a token with D1 access; without one it warns and continues.
- Concurrent builds can race on migrations. Let one finish before starting the next.
