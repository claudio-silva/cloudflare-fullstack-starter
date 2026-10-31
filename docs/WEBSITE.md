# The product website

> An **optional** marketing site on your apex domain (`acme.io`), with the app moved to a subdomain (`app.acme.io`).
> A project that does not turn it on is exactly a project without one: nothing in this document applies to it, and no command changes behaviour.

---

## What it is

Two Cloudflare Workers instead of one:

| | Worker | Serves | Has |
|---|---|---|---|
| **Website** | `<project>-website[-preview\|-production]` | `acme.io`, `preview-acme.io` | static files and ~50 lines of Worker |
| **App** | `<project>[-preview\|-production]` — *unchanged* | `app.acme.io`, `app.preview-acme.io` | D1, email, rate limits, Better Auth, every secret |

The website is a separate **script**, and that is the whole point. Cloudflare binds data and secrets to the script name, and a Custom Domain belongs to exactly one Worker. So:

- the public, high-traffic apex cannot reach the app's database, because it has no binding to it — not as a matter of code review, but as a matter of what exists;
- it ships no app JavaScript, no auth, no session cookie;
- it deploys on its own cadence, and stays up when the app's pipeline is the thing that is broken (which is why it is also the natural home for the [maintenance page](#the-maintenance-page));
- the app's script name never changes, so moving it to `app.*` moves a *route*, not data: no migration, no re-synced secret.

The same reasoning, with the live history behind it, is ADR-0007 in the project this was distilled from.

---

## Turning it on

```bash
npm run setup:website                 # asks for each value, offering its default
npm run setup:website -- --dry-run    # show the plan, write nothing
npm run setup:website -- --defaults   # ask nothing; take every default
```

It **asks** for every value it was not given on the command line, offering a default that Enter accepts; each answer feeds the next default, so choosing `console` as the subdomain offers `console.preview-acme.io` for the app's preview hostname. A domain it cannot use is refused on the spot and asked again.

| Option | Default (what the prompt offers) |
|---|---|
| `--domain <domain>` | derived from `config.baseUrls.production` by taking the app's subdomain off (`https://app.acme.io` → `acme.io`). A domain you give is used **as it is**: `test.acme.io` is a perfectly good apex, and the app then goes to `app.test.acme.io` |
| `--subdomain <label>` | `app` — where the app moves to |
| `--dir <folder>` | `website` |
| `--preview-host <host>` | `preview-<domain>` — the website's preview hostname |
| `--preview-app-host <host>` | `<subdomain>.<preview host>` — the app's preview hostname |
| `--defaults` | take the default for everything not given, and ask nothing |
| `--yes`, `--dry-run` | |

**For automation**, pass every value as an option, or pass `--defaults`. Somewhere with no terminal — CI, a subprocess, an agent — it behaves as `--defaults` on its own rather than waiting for an answer nobody can give.

`npm run init` offers it at the end (off by default), and passes the domains you gave it; `init --website` takes it non-interactively.

It changes **local files only** — nothing is deployed, no domain is attached, no secret is synced:

1. scaffolds the site in `<dir>/` from `templates/website/`, with the app's logos copied into `<dir>/public/assets/`;
2. writes `<dir>/wrangler.toml` (local / preview / production, each with its routes and its `APP_URL`);
3. adds the `app.*` custom-domain routes to `[env.preview]` and `[env.production]` of the app's `wrangler.toml`, and takes the website's own hostnames out of them — an app that still lists the apex takes it back from the website on its next deploy;
4. points `APP_BASE_URL` and `CLI_API_URL_*` at the app's new hostnames in `.env.preview`, `.env.production` and the `env/*.template` files, and `config.baseUrls` in `src/config.ts` with them;
5. adds the website scripts to `package.json` and the `website` dev service to `paseo.json`;
6. writes **`website.config.ts`**, which is what every other script reads.

Run it twice and the second run changes nothing: it reports what is already there and stops. A file the project already has — `<dir>/wrangler.toml`, a page you edited, `website.config.ts` — is never overwritten, and a hostname you chose deliberately is never silently repointed in `.env.<env>` (it says so and leaves it; see [Moving a live project](#moving-a-live-project)).

### `website.config.ts` is the switch

Its presence is what turns the feature on. `bin/lib/website-config.ts` reads it (`loadWebsiteConfig()` → `null` when there is none), and the dev runner, the deploys, the Playwright config and `setup:domain --website` all ask it rather than guessing from a folder being on disk. Delete the file and the folder and the project is back to where it started.

---

## What you get

A single page — hero, three feature cards, a closing call, a quiet footer — plus the maintenance page. Responsive, accessible, no CDN, no build step, no framework: plain HTML, one stylesheet, two small ESM modules. It is meant to be rewritten; what matters is the two mechanisms underneath it.

### The theme

The header carries a light / dark / system control. The choice is stored in `localStorage` under `app-theme` — the app's key — and applied by an inline script in `<head>` before the first paint, so there is no flash.

The site and the app are **different origins**, so they do not share that storage. The link across carries it instead: every `<a data-app-link>` gets `?theme=<choice>`, which the app's `ThemeProvider` (`src/react-app/components/theme-provider.tsx`) reads, stores and removes from the URL. Pick dark on the site, click "Open app", and sign-in opens dark and stays dark on every page after it. The rule lives in `<dir>/public/js/app-link.js` — the exact file the browser loads, and the one the unit tests import.

### The app's URL is never hardcoded

"Open app" has to be right in three places at once, and one of them has no fixed port:

| | Points at |
|---|---|
| production | `https://app.acme.io` |
| preview | `https://app.preview-acme.io` |
| local | the dev server actually running — `bin/worktree-dev` picks a free port per worktree |

The source of truth is the website Worker's `APP_URL` var, one value per environment in `<dir>/wrangler.toml`. The Worker injects it into the HTML with `HTMLRewriter` as the page is served (`<dir>/src/worker.ts`); no static file contains it. In development `dev:all` passes the real URL with `--var APP_URL:…`. If `APP_URL` were ever missing, the Worker falls back to the `app.` subdomain of the host it was reached on, so the link still lands somewhere sensible.

---

## Developing

```bash
npm run dev           # the app alone — unchanged, and still the usual command
npm run dev:website   # the website alone, pointing at the app's usual URL
npm run dev:all       # both, the website pointing at the app that just started
```

`dev:all` (`bin/dev-all.ts`) decides the app's port **once** and passes it both ways — `--port <p> --strictPort` to Vite, `--var APP_URL:http://localhost:<p>` to the website Worker. Nothing is scraped from any output. The port is, in order: `--app-port`, else the one in `APP_BASE_URL` in `.env.local` (what `bin/worktree-dev` writes, and what the auth CLI and the E2E tests already read), else `5173`. The website's own port is `--website-port` or a free one.

In a git worktree, `bin/worktree-website` starts the site beside `bin/worktree-dev`; Paseo offers it as the `website` service (added to `paseo.json` by the setup), so start both services and each worktree has its own pair.

---

## Deploying

```bash
npm run check:website              # wrangler deploy --dry-run for the site
npm run deploy:website:preview
npm run deploy:website:production  # asks before touching production

npm run deploy:preview             # the APP only — unchanged
npm run deploy:production          # the APP only — unchanged, cuts the release

npm run deploy:all:preview         # both, app first
npm run deploy:all:production      # both, app first (one release, then the site)
```

**`deploy:preview` and `deploy:production` deploy only the app, deliberately.** An earlier version of this idea deployed both from one command, and every app change dragged the marketing site through a deploy it had no reason to have. The website has no version, no migration and no release tag: it is simply deployed when it changes.

`deploy:website:production` runs `bin/deploy-production.ts --website-only`, which skips the version, the tag, the CI gate and the migrations entirely — there is no release to cut. `deploy:all:production` is the same command with `--with-website`: the app's release first, and the site once that release is confirmed live.

### CI does not deploy the website

Workers Builds (and any `external-ci` setup) builds and deploys the **app**, as before. The website is deployed from a machine, on purpose:

- it is the surface that must stay up when the app's pipeline is broken — the fewer automatic things touch it, the better;
- it changes on a different, much slower cadence than the app;
- a Workers Builds trigger belongs to one Worker script, so automating it means a second trigger with its own branch rules and its own build variables, for a site with no build step.

If you want it in CI anyway, add a second Workers Builds trigger on the website Worker with build command `echo "no build"` and deploy command `npx wrangler deploy --config website/wrangler.toml --env production`, and give it a path filter so only changes under `website/` start it. Nothing in the starter stands in the way; it just does not do it for you.

### Attaching the hostnames

```bash
npm run setup:domain -- app.acme.io  --env production              # the app
npm run setup:domain -- acme.io      --env production --website    # the website
```

`--website` attaches the hostname to the website's Worker, records it in `<dir>/wrangler.toml` and stops there: a marketing site is not what sign-in accepts, so `APP_BASE_URL` is left alone. Deploy each Worker once before attaching its domain — Cloudflare cannot attach a domain to a script that does not exist yet.

---

## The maintenance page

`<dir>/public/maintenance.html` is where the **emergency** maintenance redirect sends people (`deploy.config.ts` → `maintenance`, docs/DEPLOYMENT.md). It is served by the website Worker on purpose: the app being broken is the reason anyone is reading it. It has no script of its own and no link back to the app.

To use it:

```ts
// deploy.config.ts
maintenance: {
    mechanism: "redirect",
    zoneId: "<the zone id setup:domain printed>",
    redirectTo: "https://acme.io/maintenance.html",
    …
}
```

The planned-window mechanism is a different thing and is unaffected: a deploy that brings migrations still takes the *app* out of service in place, with a real 503 the client replays (docs/DEPLOYMENT.md, *Taking the app out of service*).

---

## Moving a live project

If the app is already in production **on the apex**, turning the website on is a cutover: a Custom Domain belongs to exactly one Worker, and the app is holding it.

Two facts decide the order, and both were learned the hard way:

- **`wrangler deploy` reassigns a Custom Domain rather than refusing it.** Deploying the website takes `acme.io` from the app Worker, silently and in seconds. No dashboard step is needed — and, the other way round, an app whose `wrangler.toml` still lists the apex **takes it straight back** on its next deploy. That is why `setup:website` removes the website's hostnames from the app's routes, and says so.
- **`APP_BASE_URL` is a secret, so it applies without a deploy.** The moment `setup:domain` syncs it, sign-in accepts only `app.acme.io`; the apex, still served by the app until the website claims it, answers 403 to a sign-in. So the window between those two steps should be minutes, not days.

In this order, per environment, preview first:

1. **`npm run setup:website`** — the app's routes gain `app.acme.io` and lose `acme.io`; `APP_BASE_URL`, `CLI_API_URL_*` and `config.baseUrls` move with them. Nothing remote has happened yet.
2. **Attach the app's new hostname:** `npm run setup:domain -- app.acme.io --env production`. It waits until it answers, then makes it the app's URL and syncs that. From here on, sign-in works only there — the next two steps are what people see.
3. **Tell everything that holds the old URL**: OAuth redirect URIs (Google, …), R2 bucket CORS `AllowedOrigins`, webhooks, API clients, monitors.
4. **Deploy the website:** `npm run deploy:website:production`. It claims `acme.io` as it deploys, so the apex becomes the marketing site and anyone signing in is on `app.acme.io`.
5. **Deploy the app:** `npm run deploy:production`. Its route set is now `app.*` only; the apex is already the website's, so there is nothing for it to release.
6. **Check all three**: `https://acme.io` serves the site, `https://app.acme.io` serves the app, sign-in works there, and "Open app" on the site lands on the app in the theme chosen. Decide what `www` does (a redirect rule to the apex is usually right).

> Deploying the **app** between steps 1 and 4 is the one thing to avoid: its routes no longer list the apex, so that deploy releases it and nothing serves it until the website is deployed.

Sessions are not carried over: cookies are host-only, so everyone signs in again once, on the new hostname.

Rolling back is the same list in reverse: put `acme.io` back in the app's `[env.production]` routes and `APP_BASE_URL`, deploy the app (which takes the domain back), and leave the website Worker without its route.

## Turning it off

Delete `website.config.ts` and the `<dir>/` folder, remove the website scripts from `package.json` and the `website` service from `paseo.json`, and put the app's routes back where you want them. Nothing else in the project knows about the feature.

---

## Files

```
website/                     # the folder --dir named (default)
├── wrangler.toml            # the website Worker: routes and APP_URL per environment
├── src/
│   ├── worker.ts            # https redirect, app links, static files
│   ├── app-url.ts           # which URL "Open app" gets (unit-tested)
│   └── worker-types.d.ts    # the few runtime types it uses; not the app's
└── public/
    ├── index.html           # the page
    ├── maintenance.html     # the emergency redirect target
    ├── styles.css
    ├── assets/              # logo-light.svg, logo-dark.svg, copied from the app
    └── js/
        ├── site.js          # the theme control
        └── app-link.js      # the theme rules + ?theme= (imported by the tests)

website.config.ts            # the switch; read by bin/lib/website-config.ts
templates/website/           # the scaffold the setup copies; typechecked and linted
bin/setup-website.ts         # the setup, with bin/lib/website.ts for its decisions
bin/dev-all.ts               # dev:website / dev:all
bin/deploy-website.ts        # deploy:website:*
bin/worktree-website         # the worktree dev service
```

### Tests

| | |
|---|---|
| `test/scripts/website.test.ts` | the decisions: hostnames, the generated wrangler.toml, `APP_URL` resolution, `?theme=`, the port rules, and a real `setup:website` on a temporary copy (defaults, every override, idempotency, `--dry-run` writing nothing) — part of `npm test` |
| `test/scripts/website-integration.test.ts` | a copy of the whole project with a website in it: typecheck, lint, build, and `wrangler deploy --dry-run` of both Workers. Slow and tool-dependent, so **not** in `npm test`: `npm run test:website:integration` |
| `e2e/website.spec.ts` | dark on the site → dark in the app → still dark on the next page; the maintenance page stands alone. Skipped when the project has no website |
