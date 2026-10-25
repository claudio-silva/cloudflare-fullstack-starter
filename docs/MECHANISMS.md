# What this starter gives you

The pieces of plumbing this template brings that you would otherwise build
yourself, and — more usefully — **why each one is the way it is**. Most entries
record a decision that has already been got wrong once; the reasoning is there
so you can tell when your project's circumstances make a different answer
correct.

For the mechanics of deploying, see [DEPLOYMENT.md](DEPLOYMENT.md). For the
Vite ↔ wrangler bridge, [VITE_CLOUDFLARE_BRIDGE.md](VITE_CLOUDFLARE_BRIDGE.md).

| | What it solves |
|---|---|
| [Database migrations](#database-migrations) | Schema changes that do not take the app down |
| [Maintenance mode](#maintenance-mode) | Stopping traffic, planned and unplanned |
| [Versions and releases](#versions-and-releases) | Knowing what is actually running |
| [Deploy modes](#deploy-modes) | The same pipeline from a laptop or from CI |
| [Secrets and build variables](#secrets-and-build-variables) | Deploying without holding every secret |
| [Sign-in log](#sign-in-log) | Who used the app, and who tried |
| [Backup and restore](#backup-and-restore) | Getting data out, and back |
| [Database portability](#database-portability) | D1, PostgreSQL or MySQL from one codebase |

---

## Database migrations

Every migration declares how it relates to the application version running
beside it. This is the *parallel change* (expand/contract) pattern, and it is
what lets almost every schema change ship with no downtime at all.

| `compatibility` | For | Runs |
|---|---|---|
| `expand` (default) | New tables, nullable columns, columns with a default, indexes | **Before** the deploy |
| `contract` | Removing what an earlier release stopped using | **After** the deploy |
| `breaking` | Anything that cannot work with the running version | Inside a maintenance window |

**Why the order is not fixed.** An additive change has to land before the new
code, because the old code ignores columns it does not know about. A removal
has to land after, because the old code is still reading them. One order
cannot serve both, so the pipeline reads the declaration instead of assuming.

**Dropping a column takes two releases.** There is always a moment when the old
code is serving requests against the new schema, so the release that stops
*using* a column and the migration that *drops* it cannot be the same one.
`safeSince` names the release that stopped using it, the deploy compares it to
the version actually live, and refuses to run early. That turns "remember to
wait a release" from discipline into a check.

**Idempotent by construction.** `ensureColumn`, `ensureIndex`, `ensureTable` and
`ensureNoColumn` ask the database before acting. This matters because MySQL and
SQLite do **not** roll back a failed migration — only PostgreSQL does, and only
because Kysely wraps the run in a transaction where the dialect supports
transactional DDL. Everywhere else, re-running the migration is the recovery,
and that only works if the statements that already applied are skipped.

**The journal.** `migration_journal` records every run: statements sent,
statements that came back, and whether the dialect rolled it back. On MySQL and
SQLite it is the only account of how far a failed migration got.
`npm run db -- journal --env <env>` reads it.

**Recovery is forward.** Correct the migration and deploy again. A `DROP COLUMN`
has already discarded the data, so "undo" is frequently not a thing that
exists. On D1 you can restore the Time Travel bookmark `--safe` printed, which
discards every write since, so only with the app quiet.

`npm run db -- new-migration <name>` scaffolds the file with its classification
already set, and refuses a `contract` with no `safeSince`.

---

## Maintenance mode

Two mechanisms, because a planned window and an emergency are different
problems. Using one for the other goes badly in both directions.

### Planned — the `MAINTENANCE` var

The deploy sets it around a `breaking` migration:

```
wrangler deploy --var MAINTENANCE:1   ← app answers 503 in place
migrate
wrangler deploy                        ← var gone, app back
```

**Why a var and not a stored flag.** A var is baked into the Worker version and
read from memory, so it costs **nothing per request**. A flag in KV or a Durable
Object would charge a storage read on every request, for something that is off
essentially all of the time. The cost is that flipping it needs a deploy — free
here, since a migration window wraps a deploy anyway.

The response follows the `Accept` header, so every kind of client gets something
it can act on:

| `Accept` | Response |
|---|---|
| `application/json` | `503` + `{"error":"Service unavailable","code":"maintenance"}` |
| `text/html` | `503` + a page that reloads itself |
| anything else | `503`, empty body |

All carry `X-Maintenance: 1` and `Retry-After`. `/api/` and `/api/cli/*` answer
normally throughout — the first is what the deploy polls to confirm the release,
the second carries the migration the window exists for. A window that hid `/api/`
would make every deploy inside one time out with the deploy having worked.

**The client rides it out.** `src/react-app/lib/maintenance.ts` patches global
`fetch`:

- the **first** response marked `X-Maintenance` starts one polling loop, seeded
  with the server's `Retry-After` (clamped to 10 minutes; 1 minute if absent),
  that polls `GET /api/ping`;
- every request after that is **held without being sent** — once the app is
  known to be down, asking it again is exactly the load it does not need, so
  only that first 503 ever costs a round trip;
- when the app answers, the held requests go out, each with its own method and
  payload, and the caller's promise resolves with the real response;
- a replay that lands in a window that opened again goes back to waiting,
  rather than handing the caller a 503;
- after 30 minutes it gives up and lets the 503 through, rather than hanging;
- requests to other origins are left alone: a third-party API failing says
  nothing about this app.

**Why the probe is `/api/ping` and not `/api/`.** `/api/` has to stay up during
a window so the deploy can read the version it is waiting for. A probe aimed at
it answers 200 throughout, and every held request is "recovered" straight into
another 503. The probe has to be down exactly when the app is, so `/api/ping`
is exempt from neither mechanism — and must not become so.

Call sites never learn any of this happened. `<MaintenanceOverlay />` shows a
banner — not a modal, and with no retry button, because the request is already
being retried and a button would only add a second one.

It patches global `fetch` rather than exporting a wrapper for the reason Angular
uses an HTTP interceptor: libraries make their own requests, and Better Auth's
would otherwise slip past.

### Emergency — `npm run maintenance`

```bash
npm run maintenance -- on --env production
```

A Single Redirect rule at the **zone**, toggled through the Cloudflare API. One
call, about five seconds, and the reason it exists: **it works when the Worker
itself is broken or compromised**, which is when an in-Worker flag cannot help.

The trade is that a redirect changes the URL, so the user cannot simply refresh.
In an emergency that is the least of the problems.

**An open tab is covered too, though it does not look like it.** A `fetch` that
meets the redirect follows it to the maintenance page, on another origin and
with no CORS headers, so the browser rejects it with a bare
`TypeError: Failed to fetch` — indistinguishable, from the caller's side, from
being offline. So on a same-origin network error the interceptor asks the probe
with `redirect: "manual"`: being redirected comes back as an `opaqueredirect`,
which `/api/ping` never answers with, and the request is held and replayed like
any other. Safe to replay, because the redirect happens at the zone and the
request never reached the Worker. A network error that the probe does not
explain is passed on to the caller as it was.

There is no `Retry-After` here — the redirect's headers are invisible to
`fetch` — so the client polls on its default minute.

Needs the zone permission *Dynamic URL Redirects Write*; a Workers-scoped token
fails with `Authentication error`. Set `mechanism: "none"` for `*.workers.dev`,
which is not part of a zone.

---

## Versions and releases

The version is `package.json`'s, baked into the build and served by `GET /api/`
as `version` and `commit`. It comes from the committed file rather than from git
tags, so every builder — your laptop, Workers Builds, GitLab CI — produces the
same value, and the tag only marks the commit that carries it.

**A production deploy is always started by `npm run deploy:production`, and
always carries a tag.** Pushing to the deployment branch without one deploys
nothing. A deploy triggered by a bare push puts code online with no version
attached, and then two different builds answer to the same version number.

Where the tag sits differs by mode, and both placements are deliberate. In
`manual` the deploy happens first and the tag follows success, so a failed
release leaves no tag claiming a version that never went live. In the CI modes
the tag comes first, because the tag is what arms the trigger.

Preview is looser: it deploys on every push to its branch with no tag, and
reports `X.Y.Z+preview.<sha>`. That is semver build metadata, ignored in
comparisons — correct, because it is the same version line built from a
different branch. A pre-release suffix would sort *below* the release, and
preview is normally ahead of production.

---

## Deploy modes

`deploy.config.ts` is committed, not `.env`, because how a project reaches
production is a decision of the project. If one developer had `manual` and
another `workers-builds`, the same command would do two different things.

| Mode | Who builds |
|---|---|
| `manual` | Your machine. No CI. The default |
| `workers-builds` | Cloudflare Workers Builds (GitHub or GitLab.com) |
| `external-ci` | Anything else, including self-hosted GitLab |

All three run the same `bin/deploy-pipeline.ts`, so a CI deploy and a laptop
deploy cannot drift apart. `--local` forces the local path in any mode.

Workers Builds triggers on branch pushes and **never on tags**, so in that mode
a deploy hook is what keeps "no deploy without a tag" true.

---

## Secrets and build variables

Three stores, by lifetime and by who needs them:

| | Where | Who sets it |
|---|---|---|
| Runtime secrets | On the Worker | A developer, `npm run sync-secrets` |
| Build variables | CI | `npm run sync-build-vars`, or your CI's settings |
| Deploy shape | `deploy.config.ts`, committed | The project |

**CI never syncs secrets**, and that is the point: deploying does not require
holding any `.env` file. Whoever owns them pushes them once, deliberately, and
everyone else ships without them.

Masking a CI variable hides it in job logs — it does **not** hide it from the
API. A token with API access and Maintainer rights reads the value regardless.

---

## Sign-in log

`login_events` records every attempt, successful or failed, with IP, user agent
and country. The `sessions` table cannot answer "who has used this app": it
holds only sessions that still exist, so it forgets every expired login and
never saw the failures.

Written through `waitUntil` — an audit record is never a reason to make a user
wait, nor to turn a successful sign-in into an error because an insert failed.
It falls back to awaiting the write where `executionCtx` is absent, since
dropping the record there would leave the log quietly incomplete.

`npm run db -- logins --env <env>` reads it. IP addresses are personal data: the
cron in `src/worker/scheduled.ts` prunes the table after
`AUTH_LOG_RETENTION_DAYS` (90 by default), and your privacy notice has to
mention it.

---

## Backup and restore

`npm run db -- backup` / `restore` work through the Worker's API, so one
implementation covers D1, PostgreSQL and MySQL. `--safe` on a migration records
a recovery point first: a D1 Time Travel bookmark, plus a full backup file
outside CI — CI disks are ephemeral, so writing a file there would be pretending.

---

## Database portability

The same codebase runs on D1, PostgreSQL or MySQL. `columnTypes()` resolves the
differences that actually bite: MySQL cannot index unbounded text, so ids and
emails are `varchar(255)`; MySQL has no `timestamptz`, so instants are
`datetime(3)`; instants are real datetimes rather than epoch integers, because
Better Auth sends `Date` and `boolean` values on PostgreSQL and MySQL.

A drift test proves the baseline and the incremental path converge to the same
schema **on every engine**, so the squashed baseline a fresh install runs cannot
silently diverge from the migrations an existing install has applied.
