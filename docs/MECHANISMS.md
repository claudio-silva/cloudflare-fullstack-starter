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
| [The HTTP layer](#the-http-layer) | Errors, lost connections and new versions handled once, not at every call |
| [Versions and releases](#versions-and-releases) | Knowing what is actually running |
| [Deploy modes](#deploy-modes) | The same pipeline from a laptop or from CI |
| [Secrets and build variables](#secrets-and-build-variables) | Deploying without holding every secret |
| [Sign-in log](#sign-in-log) | Who used the app, and who tried |
| [Demo mode](#demo-mode) | A public deployment with a published password, safe to leave online |
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

**The client rides it out.** `src/react-app/lib/http/maintenance.ts` patches global
`fetch`:

- the **first** response marked `X-Maintenance` starts one polling loop, seeded
  with the server's `Retry-After` (clamped to 10 minutes; 1 minute if absent),
  that polls `GET /api/ping`;
- every request after that is **held without being sent** — once the app is
  known to be down, asking it again is exactly the load it does not need, so
  only that first 503 ever costs a round trip;
- when the app answers, the held requests go out, each with its own method and
  payload, and the caller's promise resolves with the real response;
- **identical held reads go out once.** A polling loop keeps calling while
  the app is down, and without this every one of those calls would fire
  together on recovery, at a server that has only just come back. GET and
  HEAD requests to the same URL with the same headers are merged; each caller
  still gets its own copy of the response, and one caller aborting does not
  cancel it for the rest. **Nothing else is ever merged**, however identical:
  a POST that increments a counter sends the same payload every time, and two
  of them are two increments. PUT and DELETE are idempotent only if the server
  keeps that promise, which the client cannot check;
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

## The HTTP layer

Every API call can fail in the same handful of ways, and a call site that
handles them itself handles them differently from the next one — or not at
all. So the starter handles them in one place, on both sides, behind one
contract (`src/shared/http-contract.ts`). Feature code deals only with the
outcomes that belong to the feature.

### The contract

Every error response the Worker sends has one shape, `ApiErrorBody`:

```json
{ "error": "You can't edit someone else's post.", "code": "post_not_owned", "level": "warning", "requestId": "8f1c…" }
```

`error` is written for the person using the app and is shown as it is. The
developer's version — the real cause — goes to the logs only. Handlers say
both at once:

```ts
throw new AppError(403, "You can't edit someone else's post.", {
  log: `user ${user.id} tried to edit post ${post.id}`,
  code: "post_not_owned",
});
// or, without throwing:
return fail(c, 404, "That post no longer exists.", { log: `post ${id} not found` });
```

`app.onError` turns anything thrown into that shape: an `AppError` as the
handler meant it, Hono's `HTTPException` with its own status, and anything
else — a bug — as a generic 500 whose cause is only logged. Outside
production the cause also travels as `debug`, so a developer sees it in the
browser without opening the logs. 4xx are logged as warnings and 5xx as
errors, so an alert on error-level logs fires only for real failures.

Every response carries `X-App-Version`; every API request from the app
carries `X-Client-Version`. The server refuses nothing on the latter today: it
is logged with every error, so a failure can be traced to a stale tab, and it
is there for a "minimum client version" rule should an API ever have to change
incompatibly.

### In the browser: one interceptor, no `if (!res.ok)`

`installHttpLayer()` (`src/react-app/lib/http/interceptor.ts`, called in
`main.tsx`) patches global `fetch` — like an Angular interceptor, and for the
same reason: libraries make their own requests. Same-origin calls under
`/api/` go through it, except `/api/auth/`, whose errors Better Auth reports
to its own forms.

| Outcome | What happens |
|---|---|
| Maintenance (either mechanism) | held and replayed — see [Maintenance mode](#maintenance-mode) |
| Network failure, or 502/503/504/52x from the edge | held behind one dialog — see below |
| 4xx | the server's message as a toast (warning, or the server's `level`) |
| 401 | the same, and the session is re-checked, which brings up sign-in |
| 5xx | production: a generic message with a reference to quote; elsewhere, the real cause |

After a failure it has shown, `fetch` **rejects** with `HandledHttpError`.
The caller's code after `await fetch()` simply does not run, so call sites
need no error handling for these cases; a `catch` is only for undoing
something of their own, and should let `HandledHttpError` go (an uncaught
one is silenced, not reported). A call that handles a status itself says so,
and gets the response as usual:

```ts
const res = await fetch(`/api/posts/${id}`, { handles: [404] });
if (res.status === 404) return showEmptyState();
```

`handles: [0]` takes network failures, `handles: "all"` everything.

**Why reject rather than resolve with the error response:** a resolved error
response must be checked at every call site, and the one that forgets carries
on as if it had worked — typically by parsing the error body as data. A
rejection fails safe.

### Lost connection

A network error, or a gateway status *without* our version header (the edge
answering for an app it could not reach), opens one modal dialog that counts
down to the next check of `/api/ping` (3, 5, 10, 20, then every 30 s). However
many requests failed, there is one dialog and one check.

- **Reads** (GET, HEAD) are sent again by themselves once the app answers.
- **Writes** wait for the user to press *Send*. A write that failed on the way
  back may already have been carried out, and only the user knows whether
  sending it twice matters.
- **Cancel** rejects every held request with `HandledHttpError`.

Unlike the maintenance banner, this dialog is modal and offers a way out: a
maintenance window is known to end, a lost connection is not.

### New versions

The first response whose `X-App-Version` differs from the version the bundle
was built with opens a dialog: *Update now* reloads; *Later* leaves a banner
across the top of the page with an *Update* button, and the dialog never comes
back — the user may be presenting. Instead, while an update is pending, the
next client-side navigation becomes a full page load (`history.pushState`,
and `replaceState` when the path changes, become `location.assign` /
`replace`; Back and Forward reload). That is the one moment nothing typed on
the page can be lost. It also interrupts whatever the page was doing — a
recording, a stream — which is accepted: the alternative is old code running
indefinitely against a new API.

Equality, not ordering, decides: a rollback is a version change too. A tab
returning from the background after ten minutes asks once, since idle tabs make
no requests to learn it from; a lazily loaded chunk that no longer exists
(`vite:preloadError`) reloads the page, at most once every 30 s.

**Why not save the form and reload by itself:** restoring inputs, focus,
caret and scroll from `localStorage` works for plain forms and fails silently
for everything else — controlled React inputs, component state, panels with
their own scroll, rich editors — and writes whatever was typed, passwords
included, to storage. A partial restore the user did not ask for is worse than
a banner. A page that has a draft worth keeping should keep it explicitly.

### Client error reports

The browser's own failures — uncaught errors, unhandled rejections, stale
chunks, 5xx responses, and error responses that did not come from the app at
all (a proxy, a firewall) — are posted to `POST /api/client-errors` and
written to the Worker logs with `source: "client"`, the page, the client
version, user agent and country. Nothing is stored. Turn it off with
`config.http.reportClientErrors`.

The endpoint must be open, since the errors that matter most can happen before
sign-in, so it is built to be useless to abuse:

- **In the browser:** each distinct error is sent once per page load, at most
  25 per page, in batches every 5 s (and with `sendBeacon` on page hide),
  through the unpatched `fetch` so its own failures stay silent.
- **Same origin only.** A request without our `Origin` is dropped, which stops
  floods from visitors of a hostile page. It does not stop a script; the
  following do.
- **Bounded.** Body size is checked before parsing (32 KB), at most 10 reports
  per request, every string truncated.
- **Rate limited per IP.** With a [Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
  named `CLIENT_ERRORS_RATE_LIMITER`, the limit holds across Cloudflare;
  without one, a per-isolate budget (20 per IP and 500 in total per minute)
  still caps a burst:

  ```toml
  [[env.production.ratelimits]]
  name = "CLIENT_ERRORS_RATE_LIMITER"
  namespace_id = "1002"
  simple = { limit = 20, period = 60 }
  ```

  `wrangler.toml` declares it for preview and production, together with
  `AUTH_RATE_LIMITER` (10 sign-in attempts per IP per minute). A
  `namespace_id` is unique per Cloudflare account, not per Worker: two Workers
  in one account with the same id share their counters.

- **Always 204**, accepted or not, so probing it teaches nothing.

### Localising

The starter's own strings (`src/react-app/lib/i18n.ts`) are English defaults
under stable keys, and the starter imposes no i18n library — choosing one is
the app's decision. Plug in whatever the app uses, or change a few words
without one:

```ts
setTranslator((key, params) => (i18n.exists(key) ? i18n.t(key, params) : undefined));
overrideMessages({ "update.now": "Actualizar agora" });
```

A translator that returns `undefined` falls back to the default, so a partial
translation never shows a raw key. Placeholders are `{name}`, ICU's simple
argument. A server message is looked up as `error.<code>` first, so the
server can keep writing English and the client translate by code.

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

**The mode is also the off switch for CI.** Setting it to `manual` turns CI
deploys off without touching the CI configuration: deploy jobs start with
`bin/ci-deploy-guard.ts`, which reads the committed mode with plain `node` —
no install, no build — and ends the job green. Setting it back turns them on.
It is a committed value and not a CI variable because the local
`deploy:production` has to agree with the CI: with a CI-side toggle, the laptop
would push a tag and then wait for a deploy the CI had been told not to do.

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

The same cron deletes expired `sessions` and `verifications`. Better Auth
removes an expired session only when that session is used again, which a
visitor who never returns never does: without the job both tables grow with
every sign-in for the life of the app.

---

## Demo mode

A deployment people can try without an invitation needs a published password,
and a published password on a writable app is an invitation to abuse. The
`DEMO_MODE` secret closes it (`src/worker/middleware/demo.ts`):

- **Read-only.** Every write under `/api/` is refused with a 403
  (`code: "demo_read_only"`, level `info`) — including Better Auth's: changing
  the password or email, deleting the account, signing up, requesting resets.
  Only signing in and out, client error reports and the CLI (behind
  `CLI_API_KEY`) get through. The data never changes, so it never needs
  resetting, and a new write route is covered without anyone remembering to.
- **No email.** The writes that send mail are refused first; the email adapter
  is a no-op as well, in case a path is ever missed. An app that mails
  strangers on request is a spam relay.
- **Sign-in rate limit** per IP (`AUTH_RATE_LIMITER`). On `*.workers.dev` it has
  to be in the Worker: there is no zone, so no WAF or dashboard rule applies.
  It is not specific to demos, and stays on in every deployment that declares
  the binding.

`GET /api/demo` returns `DEMO_EMAIL` / `DEMO_PASSWORD` so the sign-in page can
offer them, and answers 404 outside demo mode. The account itself is created
once with `npm run auth create-user -- --env production`.

Refusals on `/api/auth/` carry the message in `message` as well as `error`
(`failForAuthClient`), because Better Auth's client reads `message`: the
sign-in and profile forms then show it like any other error.

**Why a secret and not a variant of the template:** everything that makes a
deployment a demo — `DEMO_*`, the database id (`D1_DATABASE_ID`), the
deploy hook — lives on that deployment. The repository stays the template, a
project created from it is not a demo, and there is nothing to strip out.

The starter's own demo is built by Cloudflare Workers Builds from `main`, with
the build variables `D1_DATABASE_ID`, `APP_VERSION_FROM=starter` (report the
template's version rather than the app's `0.0.1`) and
`DEPLOY_MODE=workers-builds`. `.github/workflows/demo.yml` calls its deploy
hook when a release is published, and does nothing in a repository without the
`DEMO_DEPLOY_HOOK_URL` secret.

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
