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
beside it. This is the *parallel change* (expand/contract) pattern: it decides
what the old and the new code can each run against.

| `compatibility` | For | Runs |
|---|---|---|
| `expand` (default) | New tables, nullable columns, columns with a default, indexes | **Before** the deploy; in a short window when the release brings it |
| `contract` | Removing what an earlier release stopped using | **After** the deploy |
| `breaking` | Anything that cannot work with the running version | Inside a maintenance window |

**Why the order is not fixed.** An additive change has to land before the new
code, because the old code ignores columns it does not know about. A removal
has to land after, because the old code is still reading them. One order
cannot serve both, so the pipeline reads the declaration instead of assuming.

**Why a release that brings migrations gets a window anyway.** Migrations run
inside the Worker, and the Worker serving traffic knows only the ones bundled
with it, so it cannot apply — or even report — those a release adds. Applying
them after the deploy would leave the new code running on the old schema. The
pipeline reads the release's migrations from the checkout
(`bin/lib/migration-plan.ts`), and when it brings any but `contract` ones it
deploys the new code in maintenance, migrates through it, and deploys it again
in service. That takes about a minute, during which the HTTP layer holds
requests and replays them. Up to 3.6 the pipeline asked the running Worker,
which answered that nothing was pending: a release's migrations ran a deploy
late, after its code. Uploading the new version without traffic and migrating
through it would remove the window; it is not done yet.

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

Call sites never learn any of this happened. A banner says what is going on
(`MaintenanceBanner` in `components/http/HttpLayerUi.tsx`), with no retry
button, because the request is already being retried and a button would only
add a second one. While requests are waiting on the window, the page is
blocked — see [Blocking the page](#blocking-the-page).

Every same-origin request is held, whether or not its caller knows the HTTP
layer (see below) — except those with `handles: "all"` and the paths in
`installHttpLayer({ exclude })`. While a window is on, the app's offline
handlers answer first, and `beforeReconnect` hooks run before the held
requests are released — see [Lost connection](#lost-connection).

**Why maintenance polls `/api/ping` while a lost connection retries the real
request:** in maintenance the app is known to be busy and down for minutes,
so held requests are deliberately *not* sent until it is back; one cheap
probe is the polite way to find out. A lost connection is usually the
user's network, and the request itself is the cheapest probe there is.

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
carries `X-Client-Version`. The latter is logged with every error, so a
failure can be traced to a stale tab, and a tab a major version away from the
server is refused (see [New versions](#new-versions)).

### In the browser: one interceptor, no `if (!res.ok)`

`installHttpLayer()` (`src/react-app/lib/http/interceptor.ts`, called in
`main.tsx`) patches global `fetch` — like an Angular interceptor — and draws
one line: **what is safe to do for any caller, it does for every caller; what
changes what a caller sees, only for callers that asked.**

For **every same-origin request**, whether or not its caller knows the layer:

| Outcome | What happens |
|---|---|
| Maintenance (either mechanism) | held and replayed — see [Maintenance mode](#maintenance-mode) |
| Network failure, or 502/503/504/52x from the edge | answered by an offline handler, or held and sent again — see [Lost connection](#lost-connection) |
| Any API response | `X-App-Version` checked — see [New versions](#new-versions) |
| 426 `client_incompatible` | this tab must update: a dialog without *Postpone* — see [New versions](#new-versions) |

Holding a request changes *when* its caller hears back, never *what* it hears,
so it is safe for code and libraries that know nothing about it. Statuses are
another matter: a library may handle a 403 or a 409 itself, and there is no
knowing which. So the rest applies only to a call under `/api/` that **opts
in** with a `handles` key that is not `null`:

| Outcome | What happens |
|---|---|
| 4xx | the server's message as a toast (warning, or the server's `level`) |
| 401 | the same, and the session is re-checked, which brings up sign-in |
| 5xx | production: a generic message with a reference to quote; elsewhere, the real cause |

The app's own code calls `http()` (`import { http } from "@/lib/http"`), a
one-line wrapper that gives `handles` a default of `[]`, so call sites carry
no ceremony.

After a failure it has shown, the call **rejects** with `HandledHttpError`.
The caller's code after `await http()` simply does not run, so call sites
need no error handling for these cases; a `catch` is only for undoing
something of their own, and should let `HandledHttpError` go (an uncaught
one is silenced, not reported). A call that handles a status itself lists it,
and gets the response as usual:

```ts
const res = await http(`/api/posts/${id}`, { handles: [404] });
if (res.status === 404) return showEmptyState();
```

| `handles` | The caller takes | The layer takes |
|---|---|---|
| absent or `null` | every HTTP response | lost connections and maintenance |
| `[]` (the `http()` default) | nothing | everything |
| `[404, 409]` | those statuses | the rest |
| `[0]` | network failures, as `fetch` gives them | the rest; nothing is held |
| `"all"` | everything | nothing — not even maintenance |

`null` meaning the same as no key makes the layer easy to switch off on a
condition: `http(url, { handles: quiet ? null : [] })`.

Better Auth's client needs one piece of wiring, and has it: its forms show its
own errors, and its requests are held through a lost connection or a maintenance
window like anyone else's. Better Auth captures `fetch` when the client is
created, which is before `main.tsx` installs the layer, so
`src/react-app/lib/auth/client.ts` passes `fetchOptions.customFetchImpl:
createAuthFetch(...)`, which looks `fetch` up per request. Without it every
Better Auth request would bypass the whole chain. A library with an offline strategy of its own — a sync engine,
an offline-first cache — would only be slowed down by having its requests
held; list its paths in `installHttpLayer({ exclude: ["/api/sync/"] })` (or
pass a test, `(url) => boolean`), and the layer leaves them alone.

**Guards.** `installHttpLayer({ guards: [...] })` takes wrappers around the
inner fetch, for behaviour that must see a request's raw response before the
layer reacts to it. The chain is layer, then `guards[0]`, and so on, then
maintenance, then the network, the first guard outermost. `main.tsx` installs
`[sessionEndedGuard, accountDisabledGuard]`: a 403 `account_disabled` is
handled inside the session-ended guard, so a disabled account is never shown the
expired-session dialog (see [Sessions](#sessions)). Guards see only the requests
the layer handles; those it leaves alone (`handles: "all"`, `exclude`,
cross-origin) go straight to the network, unguarded.

**Why the line falls there:** a global patch that changed the statuses every
request sees would break code written without knowing about it — a library
that expects its 4xx, a call site that shows its own error. The key's
presence is the caller saying it knows. Holding through an outage is
different: without it, the caller would get an error it can do nothing about
but show; with it, the same call simply succeeds later.

**Why reject rather than resolve with the error response:** a resolved error
response must be checked at every call site, and the one that forgets carries
on as if it had worked — typically by parsing the error body as data. A
rejection fails safe.

**Your own UI.** Every part of the default UI can be turned off, to show your
own built on the same state: `installHttpLayer({ ui: { connectivity: false,
maintenance: false, update: false, errors: false } })`. The state is in
`http.state` / `http.subscribe`, `connectivityStore`, `subscribeToMaintenance`
and `updateStore` (React hooks in `components/http/hooks.ts`), and the actions
are `http.retryNow()`, `http.cancelHeld()`, `updateNow()` and
`postponeUpdate()`. `onError` receives every error the layer reports, with or
without the toast. Turning a banner off changes nothing about what the layer
does: requests are still held while offline, so an app that hides the
connectivity banner must say so itself, offer Cancel, and block the page
(`useBlocked()` says when).

### Blocking the page

Trouble with requests comes in two kinds, and they are shown differently:

- **Blocking: requests are being held** — no connection, or a maintenance
  window. Letting the user carry on would only pile up requests that cannot
  be answered, in an app that has stopped responding to what they do. So the
  page is dimmed and made unusable until it is over: no clicks, no typing, no
  focus. Offline with nothing held — every request answered by an offline
  handler — is not blocking: the app works.
- **Not blocking: a new version.** The app keeps working, at some risk of
  misbehaving; a banner says so and offers to update.

A blocked page is shown in one of two ways, `installHttpLayer({ ui: {
blockWith } })`:

| `blockWith` | What the user sees |
|---|---|
| `"banner"` (default) | the banner across the top, over a page dimmed to 50 % black |
| `"dialog"` | the same content in a dialog in the middle of the dimmed page |

Either way the page underneath is made **`inert`**: every child of `<body>`
except the layer's own (`#http-layer`) — the app, and also dialogs and toasts
portalled there, including any opened while blocked. That is what the browser
offers for exactly this: inert content takes no clicks and no focus, and
whatever had focus loses it. Focus goes to *Try now*, so Enter tries again;
Tab and Shift+Tab go round the layer's own buttons; a click on the dimmed
page keeps focus where it is. When the block lifts, focus returns to where
it was. The banners stay above everything, and stay clickable even with a
Radix modal open (which sets `pointer-events: none` on `<body>`).

### Lost connection

`src/react-app/lib/http/connectivity.ts`. A network error, or a gateway
status *without* our version header (the edge answering for an app it could
not reach), means the server cannot be reached.

**What the browser can tell us, and what it cannot.** `navigator.onLine` and
the window's `online` / `offline` events are the only network signal every
browser has, and they are lopsided. `offline` is reliable: no network
interface is up, so nothing can get through, and the layer goes offline at
once, without waiting for a request to fail. `online` only means an
interface is up — a Wi-Fi without internet, a hotel portal or a server that
is down all look the same — so it only brings the next attempt forward.
What decides is a request that actually reaches the server.
(`navigator.connection` exists only in Chromium and describes the link's
speed, not whether the server answers; it is not used.)

**While offline**, each request is first offered to the app's **offline
handlers**, which may answer it from data kept locally:

```ts
http.addOfflineHandler(async (request) => {
  if (new URL(request.url).pathname !== "/api/posts") return undefined; // not mine
  const posts = await db.posts.toArray();                    // IndexedDB, say
  return Response.json(posts);
});
```

A handler gets a standard `Request` — URL, method, headers, and a body it can
read (`await request.json()`) — and returns a `Response`, or `undefined` to
pass. Handlers are asked in the order they were added; the first response
wins, and it reaches the caller marked with `X-Offline: 1`, so the app can
tell that the data may be stale. They are asked during maintenance windows
too: for the user it is the same situation. A **write** a handler accepts is
the app's from then on — keep it in an outbox and send it later; the layer
will not.

**A request no handler answers waits in line, without being sent.** Only the
oldest goes out, on a countdown (3, 5, 10, 20, then every 30 s; *Try now*
skips it; while the browser reports no network at all, nothing is tried until
it does), and it is the check: there is no status endpoint to ask. If it gets
through, the rest follow in the order they were made — writes rely on that —
and the user has nothing to repeat or confirm: they did something and want it
done, and have no way of judging which HTTP method a click turned into.
Requests made while the line is being sent join its end. Cancel gives up on
everything held: a caller that knows the layer gets a `HandledHttpError`, one
that does not gets the error `fetch` would have given it.

**A request that fails on its own** — blocked by a browser extension, a CSP
rule, a proxy — fails exactly as a lost network would. When the browser says
it is online, the layer asks `/api/ping` before believing it: if the server
answers, the request gets its own error, and nothing is held behind it.
Otherwise one blocked URL would hold up the whole app for good.

**Every write carries an `Idempotency-Key`**, the same on each retry of that
call. A write that failed on the way *back* may already have been carried
out, and sending it again repeats it. For most writes that is harmless
(setting a name twice); where it is not — a payment, an order, a message —
the endpoint should remember the keys it has served and answer a repeat with
the first result. The starter sends the key; deduplicating is the endpoint's
decision, since only it knows what a duplicate costs.

**State and events.** `http.online` is true when the server can be reached
and nothing is held; `http.state` is `online`, `offline`, `reconnecting`
(sending what was held) or `maintenance`. `http.subscribe((state, previous)
=> …)` hears every change; the window events `app:online`, `app:offline` and
`app:maintenance` announce settled changes only:

- `app:online` fires once everything that was held when the connection
  returned has been answered — not when the first request gets through. A
  failure while the line is being sent goes back to `offline` with nothing
  announced in between, so an app that syncs on `app:online` never starts
  syncing into a connection that is not there. (Requests made *during* the
  sending do not hold it back, or an app that polls could hold it back for
  ever.)
- the state changes before the event fires, so a listener reading
  `http.online` sees the new value.
- nothing is announced on page load: a page that opens offline starts
  `offline`.

`http.online` is not `navigator.onLine`, by design: that one says a network
interface is up; this one says the app's server answers.

**Syncing an outbox.** Held requests go out before `app:online`, because they
are what the user is waiting for. But a held request may depend on a write a
handler accepted earlier — "attach a file to task X", with task X still in
the outbox. Register the sync with `http.beforeReconnect(() => sendOutbox())`:
when hooks are registered, the server is asked first (`/api/ping`, so no held
request goes out before them) and the hooks run, in order, before anything
held is sent. They run at the end of a maintenance window too. A tab that is
closed while offline loses what the layer held, which lives in memory; what
must survive belongs in an offline handler's outbox. Sending it with the page
closed is the job of a service worker (Background Sync, Chromium only), not
of this layer.

### New versions

A tab learns the server's version from every response's `X-App-Version`. What
happens next depends on how far apart the two versions are.

**Soft update — same major.** The first response whose version differs from
the one the bundle was built with opens a dialog: *Update now* reloads;
*Postpone* leaves a banner across the top of the page with an *Update now*
button, and the dialog never comes back — the user may be presenting. Instead,
while an update is pending, the next client-side navigation becomes a full page
load (`history.pushState`, and `replaceState` when the path changes, become
`location.assign` / `replace`; Back and Forward reload). That is the one moment
nothing typed on the page can be lost. It also interrupts whatever the page was
doing — a recording, a stream — which is accepted: the alternative is old code
running indefinitely against a new API.

Postponing is not forever. The banner counts down `config.http.updateGraceMinutes`
(10 by default) — *"It will update itself in 9:41"* — and when it reaches zero
the tab reloads by itself. In the last minute the countdown gives way to *"N
seconds left before the update. Save any pending changes now!"*. There is no
second dialog for that minute: the banner is already in view, and a dialog
would stand between the user and the very thing it asks them to save. A
background tab's timer may fire late, never early.

**Hard update — another major.** By semver, a new major is an incompatible
release, so the tab cannot be trusted to work with the server at all: the
dialog shows *without* Postpone — Escape does nothing — over a blocked page,
and it replaces any update already postponed. Before 1.0.0 the minor counts as
the major (`0.3.x` → `0.4.0` is breaking), as semver has it. Either direction
counts: a rollback across a major breaks as surely as the release did.

The browser only learns the server's version from a response, by which time
that request has been processed. So the Worker (`versionMiddleware`) also
refuses, before anything else runs, every API request whose `X-Client-Version`
is a major away, with a **426** and `code: "client_incompatible"`; the call
rejects with `HandledHttpError`, no toast, and the same dialog shows. Not
refused: requests that do not say their version (other clients, libraries the
layer does not stamp), error reports from old tabs, and anything outside
`/api/`. A version that cannot be read is never taken for an incompatible one.

**So the version number is the switch.** Release an API change that older tabs
cannot use with `npm run deploy:production -- --major`, and every open tab
reloads at once, unsaved work and all; release everything else as a minor or
patch. The cost is the other way round: a major released for any other reason
(a redesign, say) reloads every tab just the same.

Within a major, equality, not ordering, decides: a rollback is a version
change too. A tab
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

**A commit whose CI failed is not released.** `deploy:production` reads the
GitHub Actions checks of the commit through `gh`, refuses a red one and waits
for a running one, in every mode. That is a courtesy on the releasing machine;
the guarantee is on the host: a deployment branch protected by required checks
refuses any commit without them, whoever pushes it. The two fit together
because, in the CI modes, the script pushes the release commit and waits for its
checks before it promotes the branch. The release commit is a fresh commit (it
only bumps the version) and has to earn its own green, rather than borrow its
parent's.

**Which field is the version.** `version`, unless the build environment says
`APP_VERSION_FROM=starter`; then `starter.version`, for the build and for
`deploy:production` alike. That exists for one repository, the starter itself:
it releases with its own tooling, and if it bumped `version`, every project made
from the template would be born at the template's version, its next major
release a hard update for no reason of its own.

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

Workers Builds triggers on every branch push and **never on tags**, so in that
mode the deploy itself keeps "no deploy without a tag" true: in CI, the
production pipeline refuses a commit that does not carry the `vX.Y.Z` tag of
its version, and `deploy:production` pushes the tag before it promotes the
branch.

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

## Which hosts may sign in

Better Auth refuses a sign-in whose `Origin` is not trusted, answering
`403 INVALID_ORIGIN`. Preview and production keep that strict check against
their `baseURL` — exactly what you want for a deployed app.

**Local trusts any host** (`trustedOrigins: ["*"]` in
`src/worker/middleware/auth.ts`) and derives `baseURL` from the incoming
request rather than from `config.baseUrls.local`. Dev is reached under an
open-ended set of hostnames: another port when 5173 is taken, a LAN IP when
testing from a phone, `host.docker.internal`, or a dev-workspace proxy such as
`dev--<workspace>.localhost:6767`. An allow-list cannot keep up with that —
and note that `http://localhost:*` matches the *port*, not a subdomain of
`localhost`, so a proxy hostname is refused by a pattern that looks like it
should cover it. There is nothing to protect on a developer's own machine, and
a miss is expensive: it reads like a wrong password.

Which brings us to the second half. The sign-in form maps Better Auth failures
by **`error.code`**, never by substring-matching the English `message`
(`src/shared/sign-in-error-message.ts`). The obvious test —
`message.includes("Invalid")` — also catches `Invalid origin`, so a host
problem told the user their password was wrong: the one thing they could not
fix, on the one screen with no other diagnostics. Origin rejections
(`INVALID_ORIGIN`, `MISSING_OR_NULL_ORIGIN`, the callback and redirect
variants, `CROSS_SITE_NAVIGATION_LOGIN_BLOCKED`) now say the *address* was
refused and name it; credential codes keep the credentials message; anything
unmapped shows what the server actually said.

## Sign-in log

`login_events` is a permanent history of every user, indexed by
`(user_id, created_at)`. Its `event` column says what happened:

| `event` | Written when | Also records |
|---|---|---|
| `sign-in` (`null` on rows before 0006) | a session is created by a sign-in (Better Auth's `session.create` hook), or a password sign-in fails (`success` false) | `method` (`password`, `google`, …), `session_id` |
| `sign-out` | the user signs out | `duration_seconds`: sign-in to sign-out |
| `session-expired` | Better Auth meets an expired session, or the cron deletes one (dated at the expiry) | `duration_seconds`: sign-in to the last use |
| `session-revoked` | a password or role change, disabling, "sign out everywhere", ending one device (profile, admin, CLI), an admin | the same, and `actor_id` when someone else did it |
| `user-deleted` | an account is deleted | `actor_id`: the user, the admin, or none for the CLI |

A session that ends without the user (expired, revoked) counts only to its last
use: the user was not there when it ended. Sessions are touched every 60
seconds (`session.updateAge`), so that is accurate to a minute, and
`sessions.updatedAt` serves as "last seen".

`user_stats` keeps one row of totals per user (sign-ins, failed sign-ins, time
in session, last sign-in), added to as each event is written, with a portable
insert-then-increment. Lists sort and show from it without reading the log, and
it outlives pruned rows and deleted accounts. Migration 0007 filled it from the
log as it was; sessions before then have no duration.

Writes never throw, and go through `waitUntil` where they follow the response:
an audit record is never a reason to make a user wait, nor to turn a successful
sign-in into an error because an insert failed. Without an `executionCtx`
(tests) they are awaited, so the log is not quietly incomplete there.

`npm run db -- logins --env <env>` reads it. IP addresses are personal data,
and your privacy notice has to mention them. Nothing is deleted by default: set
`AUTH_LOG_RETENTION_DAYS` and the cron in `src/worker/scheduled.ts` deletes log
rows older than that, leaving `user_stats` as it is.

The same cron deletes expired `sessions` and `verifications`. Better Auth
removes an expired session only when that session is used again, which a
visitor who never returns never does: without the job both tables grow with
every sign-in for the life of the app.

## Sessions

A signed-in person's session can end while a page is open: it idles out, an
administrator disables the account, another tab signs in as someone else. The
starter handles each case in one place instead of leaving every page to cope.
Server and browser share two small contracts: `src/shared/account-status.ts`
(403 `account_disabled`) and `src/shared/session-binding.ts` (409
`session_changed`, the `X-Session-Id` header).

### Idle expiry and route kinds

A session dies after `config.auth.session.idleTimeoutSeconds` (12 hours) without
a request. A request pushes the expiry forward at most once per
`refreshAfterSeconds` (a minute), and that push is also the "last seen" the
admin area shows. Both values feed Better Auth's `expiresIn` and `updateAge` in
`src/worker/middleware/auth.ts`.

Not every request is the user doing something. Polling, heartbeats and periodic
checks would keep a forgotten tab signed in for ever. A route says which kind it
is by listing the `background` marker from `src/worker/lib/route-kind.ts`
among its handlers, in any position relative to `authMiddleware`:

```ts
import { background } from "../lib/route-kind";

app.get("/api/status", background, authMiddleware, handler);
```

A `background` route still needs a live session, but reads it with
`disableRefresh`, so it never extends it. Give a background flow its own route
rather than a flag from the client: the server must know the kind without
trusting the caller. A sub-app with its own `onError` hides the marker from
Hono's matched handlers; there it works only when listed before the auth
middleware.

`authMiddleware` sends Better Auth's `Set-Cookie` (the refreshed session) only
after the request has passed every gate: live session, account enabled, tab
binding. A refused request therefore never renews anything for its caller.

The starter marks no route. Its only background traffic (the version check and
the maintenance probe) goes to `/api/ping`, which is public. A project with
its own authenticated polling route marks it.

### Disabled accounts

Every path that acts for a signed-in user answers a disabled account with HTTP
**403** `{ error, code: "account_disabled", level: "info" }` (built by
`accountDisabledBody()`): every `authMiddleware` route, `GET /api/auth/get-session`
(otherwise a 200 with `null`), and the 401 of any other Better Auth route. 401
keeps meaning "no session, or an expired one", so a client can tell *expired*
from *refused*.

Disabling deletes the user's sessions, after which the server could not tell
"disabled" from "expired". So each session's token is first copied to
`session_revocations` (migration 0008, `src/worker/lib/session-revocations.ts`)
until it would have expired. Markers are:

- written when a user is disabled (admin area, `npm run auth enable-user -- -s off`);
- cleared when the user is enabled again and when the user is deleted;
- pruned by the cron that removes expired sessions;
- read only when a request has **no** session (a live session costs no extra
  read), and only honoured while the user is still disabled.

Ending sessions by other means (sign out everywhere, a role downgrade, a
password change) writes no markers: those are plain 401s.

In the browser, `withAccountDisabledGuard` (`src/react-app/lib/auth/account-disabled.ts`)
sends the tab to the public `/account-disabled` page when any same-origin
`/api/` response is a 403 with that body. The request's promise never
settles, so no caller shows an error on the way out, and the session-ended
dialog is never shown to a disabled account. A tab that makes no request is
expelled on its next request or when it regains focus (the focus refetch
reads get-session); there is no polling for it.

**Sign-in.** The password is checked first (`src/worker/lib/sign-in-guard.ts`).
Better Auth's session hook (`databaseHooks.session.create.before`) refuses a
disabled user, and Better Auth then answers 401 `FAILED_TO_CREATE_SESSION`,
which only happens after the credentials were accepted. That one answer, and
only that one, becomes 403 `account_disabled`, without a session or a cookie.
A wrong password gets the ordinary invalid-credentials answer whether or not the
account is disabled, so a disabled account is never revealed to someone who
does not know its password. Google and email-link sign-ins reach the same hook
and get no session.

Known limit: a browser that still carries the cookie of a session a disable
ended gets 403 `account_disabled` for any failed sign-in, whatever email is
typed (`disabledAwareCatchAll` looks at the cookie, not the email). It depends
on the cookie, not on the email, so it reveals nothing about other accounts.

### Session ended

When the session ends under an open page (idle expiry, "sign out everywhere"
from another device) the page is kept and a dialog asks for a new sign-in
(`src/react-app/lib/auth/session-ended.ts`, `components/auth/SessionEndedDialog.tsx`).
What the user was doing survives, and the requests that failed run after they
sign in.

- **Armed.** The tab is armed once get-session has returned a user. Only then
  does a 401 mean "ended"; a visitor who was never signed in sees the sign-in
  page as usual.
- **Held.** `withSessionEndedGuard` holds a same-origin `/api/` request answered
  401, and every request made while the dialog is open, and replays it after the
  sign-in, so its caller gets the replay's response and never the 401. Replay is
  safe because `authMiddleware` refuses before any handler runs. Not held:
  `/api/auth/*` (the sign-in and the session refetch are what end the wait),
  the client-error reports, requests with a stream body, and a `keepalive`
  request sent after `pagehide` (nothing can await across an unload). Those get
  their 401 as before.
- **Replay order.** Identical reads merge into one call (the maintenance
  interceptor's `sendReplay`); writes never merge and go one after another in
  arrival order; reads go in parallel. At most two rounds, then the last
  response is returned.
- **The page is kept.** While a write is held, `held-requests.ts` adds a
  `beforeunload` prompt. `standDownUnloadGuards()` switches every such guard off
  for a forced expulsion (another account, the disabled page) so the browser does
  not ask a second time.
- **Use another account** confirms (if a write is held), signs out, and
  navigates. The sign-out is bounded by a 4 s timeout so a stalled connection
  never traps the user (`components/auth/leave-session.ts`). The same confirm
  guards the forgot-password link. Leaving is sticky (`leave()`): nothing the page
  held is ever replayed under another login; the navigation drops it.
- **Privacy.** The dialog shows the email remembered in `localStorage`
  (`auth.lastEmail`, removed by a sign-out). If the session ended with no
  remembered email (an explicit sign-out in this or another tab, or storage
  unavailable) the page reloads to `/` instead of showing the dialog over a
  previous user's page. The cold-load sign-in page always starts empty.
- **Same account** carries on; a different account reloads to `/`.

### Re-login by sign-in method

The dialog asks for what the account actually signs in with, never a password
for a Google-only account. The methods are learned while the page is healthy
(once the session has ended nothing can be asked of the server): after the first
session seen, `rememberSignInMethods` reads `listAccounts()` and stores the
provider ids and the email under `auth.lastMethods`
(`src/react-app/lib/auth/reauth-methods.ts`). `resolveReauthMethods` turns that
into what the dialog shows: a password field (the account has `credential`, or
its methods are unknown), a "Continue with" button per social provider the
deployment offers, and the components of the app's own methods. Unknown offers
everything the deployment has except app-registered methods.

**Social.** The popup is opened in the click's own turn (after an `await` a
browser blocks it), at `about:blank`, then pointed at the provider URL from
`signIn.social({ disableRedirect: true })`. The popup lands on
`/auth/reauth-complete`, which tells the page over
`BroadcastChannel("auth-reauth")` and closes itself. A channel, not
`window.opener`: Google's cross-origin-opener policy severs the handle. The page
refetches the session and the usual machinery restores or leaves. If the popup is
blocked the only way left is a full redirect, which drops the page, so it is
confirmed first (the discard confirm) and the provider returns to the page; a
refusal shows once as a message (`takeReauthError`).

**An app's own method.** `registerReauthMethod({ providerId, Component })`
adds a method whose Better Auth account `providerId` is `providerId`; the
component is rendered for accounts that have it. It must finish the sign-in in a
way that ends in a new session for the same page (a popup, or a link opened
elsewhere) and must not navigate this page away without
`confirmAndDiscardForNavigation`. The starter registers none.
`registerReauthMethod` throws on a reserved id (`credential`, or a social
provider the dialog offers itself) and on a duplicate, in every environment, so
a duplicate registration fails at module load, not in front of a user.

**Adding magic-link sign-in later.** The starter has none; the slot is ready.
Checklist:

1. Add Better Auth's `magicLink` plugin in `createAuth` (`src/worker/middleware/auth.ts`)
   with a `sendMagicLink` that uses the email sender, and `magicLinkClient()` in
   `src/react-app/lib/auth/client.ts`. Add the email template.
2. The tab-binding allow-list already exempts `magic-link`
   (`BINDING_EXEMPT_AUTH_SEGMENTS` in `src/worker/lib/auth-requests.ts`): the
   verify call arrives from a link, in a tab that has no session id.
3. **Disabled accounts.** The session-create hook already refuses a disabled
   user, so no session is made. But the verify call is a `GET /api/auth/magic-link/verify`,
   and the password guard (`signInWithDisabledGuard`) wraps only
   `POST .../sign-in/email`. So a disabled account's verify gets Better Auth's
   generic failure, not 403 `account_disabled`: a redirect to the
   `errorCallbackURL` with `?error=failed_to_create_session`, and the link is
   spent. Someone holding the link has proved they own the mailbox, so telling
   them the account is disabled reveals nothing. To say it, make the app's
   `errorCallbackURL` page treat `error=failed_to_create_session` as "account
   disabled" and go to `/account-disabled` (that code can only come from the
   session hook, which refuses nobody else). The step that *sends* the link
   answers `{ status: true }` for every address, so it reveals nothing either.
4. Register the re-login: a component that asks for the link without leaving the page.
   ```tsx
   import { registerReauthMethod } from "@/lib/auth/reauth-methods";
   import { authClient } from "@/lib/auth/client";

   registerReauthMethod({
     providerId: "magic-link", // the account's providerId
     Component: ({ email }) => (
       <Button onClick={() => authClient.signIn.magicLink({ email, callbackURL: "/auth/reauth-complete", errorCallbackURL: "/auth/reauth-complete?error=1" })}>
         Email me a link
       </Button>
     ),
   });
   ```
   The link opens in another tab or the mail app, lands on `/auth/reauth-complete`,
   and the open page refetches the session on focus. Magic-link users have an
   account whose `providerId` Better Auth records as the one the plugin creates;
   check what `listAccounts()` returns for a magic-link-only user and use that id.
5. Map its error codes (`INVALID_TOKEN`, `EXPIRED_TOKEN`, `failed_to_create_session`)
   in `signInErrorMessage` (`src/shared/sign-in-error-message.ts`), matching the
   code, never the English message.
6. Test: a disabled account's verify gets no session and no cookie; a magic-link-only
   account's dialog shows the button and no password field; the dialog restores the same
   page after the link; a Google-only account is unaffected.

### Tab session binding

Cookies are shared by every tab of a browser profile, so a tab left open under
one account would act under whichever account the cookie holds now. Each tab
binds itself to the Better Auth `session.id` it learned from get-session (in
memory only: a reload adopts the cookie's session, a sign-out clears it).

- **Sent.** The session-ended guard adds `X-Session-Id` to every same-origin
  `/api/` request, replays included, reading the id when the request is sent.
- **Checked.** `authMiddleware` compares it with the session the cookie resolves
  to, after the session is loaded and after the disabled gate: a different id is
  409 `{ code: "session_changed" }`, before any handler, with no `Set-Cookie`.
  Precedence: 401, then 403, then 409. No id means no check (CLI with an API key,
  curl, old clients). Better Auth's own `/api/auth/*` routes pass the same check
  (`refuseStaleAuthRequest`), except an allow-list of the sign-in and recovery
  flows where a missing or old session is normal (`BINDING_EXEMPT_AUTH_SEGMENTS`
  in `src/worker/lib/auth-requests.ts`). Anything not listed (update-user,
  change-password, delete-user, ...) is checked, so a stale tab cannot change the
  account the cookie holds now.
- **Reaction.** The guard holds the 409 like a 401 and settles it with one
  get-session, shared by every request refused at the same time. Same account:
  the tab adopts the new id and replays the request once (a second refusal is
  returned as it is, never a loop). Different account: the page leaves, a flag
  is set in `sessionStorage`, it reloads `/`, and `SessionReplacedToast` shows
  "The previous session in this tab was ended." once. Nothing is ever replayed
  under another account.

Known limits:

- A request with `handles: "all"`, or one the layer `exclude`s, skips the guards,
  and still carries no header, so it gets no check. `navigator.sendBeacon`
  carries nothing.
- Another tab's sign-in is noticed on the next request or when this tab regains
  focus, not at once.
- A same-account stale tab calling a Better Auth account route (update-user, for
  example) gets the 409 back and must retry: those calls are not replayed.
- The session is loaded, and refreshed, before the comparison, so a stale tab's
  refused request on a normal route still pushes the other session's expiry
  forward (no cookie goes to the stale tab).
- A keepalive request sent at unload by a same-account tab that has not adopted
  the new id yet is refused and lost.

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
- **Visitors' addresses stay private.** Visitors share the demo accounts, so
  their sessions and sign-in log fill with strangers' IPs. The admin area
  shows them with the last part hidden (`203.0.113.x`, `demoIp()`), and Better
  Auth's `GET /api/auth/list-sessions`, which the UI does not use, answers 403
  (`demo_hidden`). Only the display changes: the log keeps the full addresses
  for whoever reads the database (`npm run db -- logins`), so a demo account
  can be a superadmin and show the whole admin area.

`GET /api/demo` returns the accounts in `DEMO_EMAIL` with their roles and
`DEMO_PASSWORD`, so the sign-in page can offer them, and answers 404 outside
demo mode. `DEMO_EMAIL` may list several addresses, comma-separated, sharing
the password: the starter's demos have one account per role
(`user@example.com`, `admin@example.com`, `superadmin@example.com`), and the
form has a button per role that fills it in. The accounts themselves are created once with
`npm run auth create-user -- --env production`.

The starter's own demo also shows the starter's mark instead of the app's
logo (`Logo.tsx`): the mark is in `src/react-app/assets/demo-brand/`, which
`npm run init` deletes, so a project's demo shows the project's logo.

Refusals on `/api/auth/` carry the message in `message` as well as `error`
(`failForAuthClient`), because Better Auth's client reads `message`: the
sign-in and profile forms then show it like any other error.

**Why a secret and not a variant of the template:** everything that makes a
deployment a demo — `DEMO_*`, the database id (`D1_DATABASE_ID`), the
Workers Builds connection — lives on that deployment. The repository stays the template, a
project created from it is not a demo, and there is nothing to strip out.

The starter's own demos are two such deployments, built by Cloudflare Workers
Builds with the build variables `D1_DATABASE_ID`, `APP_VERSION_FROM=starter`
(report — and release — the template's version rather than the app's `0.0.1`)
and `DEPLOY_MODE=workers-builds`. The production demo shows the latest
release: the starter's own `npm run deploy:production` tags it and promotes
`release`, which Workers Builds builds. The preview demo builds every push to
`main`. This is
the starter using its own pipeline; a project made from the template inherits
none of it. See `docs/DEPLOYMENT.md`, *The starter's own releases*.

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
silently diverge from the migrations an existing install has applied. "Same"
covers column types, default values, indexes (with uniqueness and partial
predicates) and foreign keys, not just tables and columns
(`test/support/schema-structure.ts`).
