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

**The client handles this by itself.** `src/react-app/lib/http/maintenance.ts` patches global `fetch`:

- the **first** request to come back with `X-Maintenance` starts a single polling loop, seeded with the server's `Retry-After`;
- every request made after that is **held without being sent** — once the app is known to be down there is no point asking it again, so only that first 503 ever costs a round trip;
- when the app answers, the held requests go out, each with its own method and payload, and the caller's promise resolves with the real response. Identical reads (GET/HEAD, same URL and headers) go out **once** and share the response, so a polling loop that kept calling during the window does not fire a burst on recovery. Writes are never merged: two identical POSTs can be two increments;
- the emergency redirect below is handled the same way, though it looks nothing like a 503 to `fetch` — see [MECHANISMS.md](MECHANISMS.md#maintenance-mode).

Recovery is judged by polling `GET /api/ping`, **not** `/api/`. `/api/` is exempt from maintenance so the deploy can read the version, which means it answers 200 all through a window.

A banner tells the user what is happening and, while requests are waiting, the page is blocked; the app's offline handlers, if any, answer in the meantime. Call sites never learn that any of it occurred.

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

With `APP_VERSION_FROM=starter` (a build variable, see below) the release field is `starter.version` instead, for the build and for `deploy:production` alike. Only the starter's own repository needs it: see [The starter's own releases](#the-starters-own-releases).

**A production deploy is always started by `npm run deploy:production`, and always carries a tag.** Pushing or merging into the deployment branch without one deploys nothing: a CI production deploy first checks that the commit carries the `vX.Y.Z` tag of the version it reports (`bin/lib/release-tag.ts`, looked up on `origin` when the CI clone has no tags), and fails otherwise. The reason is simple: a deploy triggered by a bare push puts code online with no version attached to it, and then two different builds answer to the same version number.

```bash
npm run deploy:production              # patch
npm run deploy:production -- --minor   # or --major, or -v 2.1.0
npm run deploy:production -- --dry-run # show the plan, change nothing
npm run deploy:production -- --local   # build and deploy from here, whatever the mode
npm run deploy:production -- --release-only   # bump, tag and push; deploy nothing
npm run deploy:production -- --no-ci-check    # release although CI has not passed (emergencies)
```

It runs from a clean `main` that equals `origin/main`. If `HEAD` already carries a tag, that version is redeployed instead of bumped. A new project starts at `0.0.1` (pre-alpha) and its first release is that version, unbumped. After that each release bumps the latest tag — unless `package.json` is ahead of it, which means someone set the version by hand (say `1.0.0` for the first stable release), and that version is released as it is. **Never run it against production without the owner's approval.**

**Choose the bump by compatibility, not by size.** Open tabs read the version: a minor or patch is a soft update (the user may postpone it for `config.http.updateGraceMinutes`), a new major — before 1.0.0, a new minor — is a hard one: every open tab is told to reload at once and its API requests are refused until it does. Use `--major` exactly when the API changes in a way older tabs cannot use. See `docs/MECHANISMS.md`, *New versions*.

**A commit whose CI failed is not released.** Before changing anything, the script reads the GitHub Actions checks of `main` through the `gh` CLI: it stops if one failed, and waits while they run. In the CI modes it also pushes the release commit and waits for *its* checks before tagging and promoting, so that a deployment branch protected by required checks (below) accepts it; if they fail, no tag is made and the next run releases the same version. Without GitHub Actions, on another host, or without `gh`, it says so and goes on ungated. Checks from other apps — a Workers Builds preview build — are not a verdict on the code and are ignored.

Where the tag sits in the sequence differs by mode, and both placements are deliberate:

- **`manual`** — deploy first, tag after it succeeds. There is no trigger to arm, so a failed release should not leave a tag claiming a version that never went live.
- **`workers-builds` / `external-ci`** — CI first, then the tag, then promote the branch, because the tag is what the build checks. The script then waits for `GET /api/` to report the version it released. A tag whose deploy failed stays behind; it means "handed to the pipeline", and `/api/` tells you what is actually serving.

Preview is looser on purpose: it deploys on every push to its branch with **no tag**, and reports `X.Y.Z+preview.<sha>` (`bin/lib/build-info.ts` adds the suffix to any `--mode preview` build). That is semver build metadata, ignored when comparing versions, which is right — it is the same version line, built from a different branch. A pre-release suffix would sort *below* the release, and preview is normally ahead of production, not behind.

A project begins its own tag line: create it from the template without the starter's git history (as `docs/AGENTS_SETUP.md` does), because the starter's own `vX.Y.Z` tags are *template* releases and would otherwise seed the first version. GitHub's *Use this template* already copies one commit and no tags; leave **Include all branches** unticked, or the starter's `release` branch comes along too.

### The starter's own releases

The starter releases itself with this same command, and its demos are deployed by this same pipeline. Nothing of it reaches a project made from the template: everything that differs lives in the starter's own gitignored `.env.*` files and on its Cloudflare deployments.

- **Version field.** `APP_VERSION_FROM=starter` in `.env.production` and `.env.preview`. `deploy:production` bumps and tags `starter.version`, the builds report it, and `version` stays at the `0.0.1` new projects start from. Without it the starter would commit `version: 3.x` to `main`, and every new project would be born at that version, with the next major release a hard update for no reason.
- **Mode.** `DEPLOY_MODE=workers-builds`, so the committed `deploy.config.ts` keeps `manual` for projects.
- **Production demo** — Worker `cloudflare-fullstack-starter-production`, its own D1 (`D1_DATABASE_ID`), `DEMO_MODE`. Workers Builds builds every push to `release`, and only `deploy:production` pushes there, after the tag. It shows the latest release.
- **Preview demo** — Worker `cloudflare-fullstack-starter-preview`, its own D1, `DEMO_MODE`. Its Workers Builds branch is `main` (`DEPLOY_BRANCH=main`), so every push shows the work in progress as `X.Y.Z+preview.<sha>`.
- **CI gate.** `release` is a protected branch requiring the `build-and-lint` and `e2e` checks of `ci.yml`, for administrators too; `deploy:production` waits for them, as described above.

A release of the starter is then: write its `UPGRADING.md` entry, and run `npm run deploy:production -- --minor` (or `--patch` / `--major`, by what an upgrade breaks).

## Build variables

Local builds read `.env.<env>`; a CI build has no such file. `npm run sync-build-vars -- <env>` (also run by the deploy commands) pushes to the Worker's Workers Builds triggers, so CI builds see the same values:

| Pushed as | Keys |
|---|---|
| Plain build variable | every `VITE_*` (public by definition: it ends up in the client bundle), `CLI_API_URL*`, `DEPLOY_MODE` / `DEPLOY_BRANCH` (read by the CI guard), and `D1_DATABASE_ID` / `APP_VERSION_FROM` (read by the build; see below) |
| Secret build variable (write-only) | `CLI_API_KEY`, which CI needs to run migrations through the Worker |

`D1_DATABASE_ID` replaces the `DB` binding's `database_id` in the generated config, so a deployment can use its own database without editing the committed `wrangler.toml` — that is how the starter's demo runs from the template unchanged. `APP_VERSION_FROM=starter` makes the build report `starter.version` instead of `version`, and `deploy:production` bump it. Neither is a Worker secret: `sync-secrets` skips them, and every `DEPLOY_*` key.

Whoever holds the `.env.*` files is the source of truth: their values overwrite the cloud ones; keys missing from the file are left untouched. Everyone else just uses what was pushed. Runtime secrets still go through `bin/sync-secrets.ts` (it skips `VITE_*`).

It needs a **user API token** (not an account token) with *Workers Builds Configuration: Edit* and *Workers Scripts: Read*, plus the account id, in the process environment or in `.env.setup.local` (gitignored):

```bash
CLOUDFLARE_API_TOKEN=...
CLOUDFLARE_ACCOUNT_ID=...
```

Without a token, without a deployed Worker, or before the repository is connected in the dashboard, it prints a notice and exits 0.

## Your own domain: `npm run setup:domain`

Each environment starts on its `workers.dev` URL. To serve one on a domain of yours, with or without CI:

```bash
npm run setup:domain -- app.example.com --dry-run                # what it would do
npm run setup:domain -- app.example.com                          # production
npm run setup:domain -- preview.example.com --env preview
```

Before it: the domain's zone is on your Cloudflare account (dashboard → *Add a domain*, nameservers pointed to Cloudflare), the hostname has no DNS record of its own, and the environment's Worker has been deployed once. Credentials: the token in `.env.setup.local` if there is one, otherwise wrangler's own login (`npx wrangler login`).

Each step checks first, so it is safe to run again, and nothing is deployed:

1. **Attach** — the hostname is attached to the Worker through the API; Cloudflare creates its DNS record and certificate. The command waits until `https://<hostname>/api/` answers (usually a minute or two).
2. **`wrangler.toml`** — `routes = [{ pattern = "<hostname>", custom_domain = true }]` under `[env.<env>]`, so every later deploy keeps the domain, and the maintenance window finds its hostname there. Commit it.
3. **The app's URL** — `APP_BASE_URL` and `CLI_API_URL_<ENV>` in `.env.<env>` become `https://<hostname>`, and are synced (`sync-secrets`, `sync-build-vars`). Only now, because sign-in accepts only that origin.

The next deploy turns the `workers.dev` URL off: it is wrangler's default once a Worker has routes, and it leaves one address for the app. To keep both, set `workers_dev = true` under `[env.<env>]`.

## Running it in CI

`deployConfig.mode` picks who builds. All three run the same pipeline.

### `manual`

No CI. `npm run deploy:production` does everything from your machine. The default, and perfectly sound for a small project.

### `workers-builds` — Cloudflare Workers Builds

GitHub or GitLab.com only; **self-hosted GitHub or GitLab is not supported** — use `external-ci` there.

#### Setting it up: `npm run setup:ci`

On GitHub, one command does the whole setup, for preview and production:

```bash
npm run setup:ci -- --dry-run   # what it would do
npm run setup:ci                # do it; safe to run again
npm run setup:ci -- --env preview
```

Before it: the project has its own GitHub repository as `origin` (not the starter's), `main` is pushed, `gh` is logged in, and `.env.setup.local` holds a **user** API token with *Workers Scripts: Edit*, *D1: Edit* and *Workers CI: Edit* (without one, the command prints a link that opens the token page with most of it ticked; the account id is detected).

Each step checks before it changes anything:

1. **`.env.<env>`** — created from `env/<env>.env.template` if missing; empty `BETTER_AUTH_SECRET` / `CLI_API_KEY` generated; `example.com` URLs replaced by the Worker's `workers.dev` URL; the D1 database found or created by its `database_name`, its id written as `D1_DATABASE_ID` (only while `wrangler.toml` holds the placeholder). A value you set is never touched.
2. **The Worker** — deployed once from your machine if it does not exist: `deploy:preview` for preview, `deploy:production --local` for production, which makes that deploy the first release (it asks first; `--yes` does not).
3. **The trigger** — created, or corrected to the table below: the branch, the build and deploy commands.
4. **Build variables and secrets** — `sync-build-vars` and `sync-secrets`.
5. **The release branch** — protected by a GitHub ruleset that requires the GitHub Actions checks found on `main`, with no bypass. A ruleset works before the branch exists, so the first release is gated too. Left alone if the branch already has protection; on a private repository of a free plan GitHub refuses, and the command says so.
6. **`deploy.config.ts`** — `mode: "workers-builds"`. Commit and push it: CI deploys stay off until the mode reaches the branch.

One step needs a browser, once per account: Workers Builds deploys with a build token that only the dashboard creates, and reads the repository through the Cloudflare GitHub app. When either is missing the command says what to click (connect any of the Workers in the dashboard — the settings typed there do not matter, the next run corrects them) and stops; run it again afterwards.

If the GitHub app was installed with *Only select repositories*, add each new repository to it (GitHub → Settings → Applications → Cloudflare Workers and Pages → Configure). Cloudflare accepts the connection either way and nothing reports the gap: pushes simply start no build. `setup:ci` reminds you when it connects a repository.

With `--domain app.example.com`, production is also put on that domain once its Worker exists, as `npm run setup:domain` does (below). An `APP_BASE_URL` already set to a domain of your own (`npm run init` asks for one) is taken the same way, for either environment.

#### The settings, by hand

Per Worker: dashboard → Workers & Pages → the Worker → Settings → Builds → connect the repository.

| Setting | Production Worker | Preview Worker |
|---|---|---|
| Git branch | the deployment branch (`release` by default) | the preview branch (`preview` by default) |
| Build command | `npm run build:production` | `npm run build:preview` |
| Deploy command | `npm run deploy:ci -- --env production` | `npm run deploy:ci -- --env preview` |
| Enable Preview Builds | **off** | **off** |
| Root directory | empty (the repository root) | empty |
| API token | *Create new token* | the same token |

Workers Builds installs the dependencies itself, from the lockfile, and takes Node from `.nvmrc`. Add `&& npm run lint && npx tsc -b && npm test` to the build command if you want it to gate on tests too.

*Enable Preview Builds* would build every push to any other branch as a Cloudflare "Preview" of the same Worker, with settings of its own; the preview environment here is a Worker of its own (`[env.preview]`), so leave it off on both. The preview Worker's *production* branch is your preview branch.

Workers Builds builds **every push to its branch** (it has no switch for that) and never a tag. `deploy:production` therefore pushes the tag first and promotes the branch after; the deploy then refuses any commit without its release tag, so a push to the branch made by hand fails rather than deploys.

A push starts its build through GitHub's webhook, and a webhook can be lost: the branch moves and nothing builds. After promoting, `deploy:production` checks that Workers Builds started a build; if none has started after two minutes, it starts one itself through the API (the branch's head, which is the release commit). It needs the token of `.env.setup.local`; without one it only waits for the version.

The build command is an ordinary shell command: if it exits non-zero the build fails and the deploy step never runs. So CI *can* gate on tests. What it cannot do is run service containers or browsers, so a Postgres/MySQL matrix and Playwright stay in GitHub Actions.

To make those GitHub Actions checks a hard gate, protect the deployment branch (`setup:ci` does it with a ruleset; by hand: GitHub → Settings → Rules → a branch ruleset for `release` with *Require status checks to pass*, the jobs of your CI workflow, and no bypass list). A push of a commit without passing checks is then refused by GitHub itself, whoever pushes it. `deploy:production` waits for the checks of its release commit before promoting, so the protection costs a release nothing but that wait.

### `external-ci` — your own CI

Anything else, including self-hosted GitLab. Trigger the pipeline on tags and run:

```yaml
deploy:production:
  rules:
    - if: $CI_COMMIT_TAG =~ /^v\d+\.\d+\.\d+$/
  script:
    # First, before installing anything: ends the job, green, when CI deploys are off.
    - node bin/ci-deploy-guard.ts || { [ $? -eq 78 ] && exit 0; exit 1; }
    - npm ci
    - npm run build:production
    - npm run deploy:ci -- --env production
```

Mark the Cloudflare token as a **protected** CI variable and protect the deployment branch, so a token for production is never exposed to a pipeline running on some other branch.

### Switching CI deploys off, and back on

Set `mode: "manual"` in `deploy.config.ts` and commit. That is the whole switch, in both directions — for when the CI host is down, overloaded, or simply not to be trusted with a release this week.

With it off:

- `deploy:production` builds and deploys from your machine, then tags. The tag is pushed with GitLab's `ci.skip` push option, so it starts no pipeline there.
- Any CI deploy job that does run anyway — a push to the preview branch, a retried job, a host that ignores `ci.skip` — stops at its first step, `bin/ci-deploy-guard.ts`, and ends **green** having done nothing. Green, because "deploys are off" is the configured state, not a failure. `deploy-pipeline` makes the same check, for CI that runs it without the guard.
- Verification jobs (lint, tests) are untouched: the switch is about who deploys, not about whether CI runs.

To turn them back on, set the mode back to `external-ci` or `workers-builds`.

It is a committed value rather than a CI variable on purpose: `deploy:production` on every developer's machine has to read the same answer as the CI. A CI-side toggle would leave the local command pushing a tag and waiting for a deploy that the CI had been told not to do.

`--local` is different: a one-off, with the mode unchanged. It too pushes the tag with `ci.skip`; on a host that ignores it, the CI will deploy the same commit a second time — harmless, but wasted.

### What CI needs, and what it does not

- **CI never reads `.env.*`** (they are not in git). What the build and the Worker read from them is kept on Cloudflare — runtime secrets on the Worker, build variables on the Workers Builds trigger — and sent there from the machine that holds the files, only what changed since the last time:
  - `deploy:production` does it in every mode: in a CI mode just before it promotes the branch, so the build that push starts reads the new values.
  - A push to the preview branch runs nothing on your machine: after editing `.env.preview`, run `npm run sync-env -- preview` before pushing (`sync-build-vars` plus `sync-secrets`).
  - A secret sent before the deploy is live at once, for the version still running. Adding one is harmless; a changed value takes effect a few minutes before the new code, as it does in `manual` mode.
- **Build variables** are the ones above. In `workers-builds` they come from `sync-build-vars`; in `external-ci` they are your CI's variables.
- **Migrations** need `CLI_API_KEY` and `CLI_API_URL_<ENV>` in the build.
- The CI disk is ephemeral, so `--safe` records only the Time Travel bookmark there. That needs a token with D1 access; without one it warns and continues.
- Concurrent builds can race on migrations. Let one finish before starting the next.
