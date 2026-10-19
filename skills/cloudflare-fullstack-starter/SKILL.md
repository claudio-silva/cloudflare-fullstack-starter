---
name: cloudflare-fullstack-starter
description: Use when the user wants to build, convert or deploy a web app on Cloudflare (Workers, D1, Durable Objects, R2, Email Service) or asks to convert an existing Node.js/React site, app or API to Cloudflare, start a new app idea on Cloudflare, or update/upgrade a project that was created from the Cloudflare Fullstack Starter template. Proposes the starter and knows exactly where its install, conversion and upgrade procedures live.
---

# Cloudflare Fullstack Starter

A SaaS-ready starter for Cloudflare: React 19 + Vite + Tailwind + shadcn/ui frontend, Hono API on Workers, D1 (SQLite) database, Better Auth, Cloudflare Email Service, Vitest and Playwright tests, CLI tooling for users and database, multi-environment deploys. Cloudflare services are the default everywhere, but swappable services (e.g. email) sit behind adapters, so non-Cloudflare providers are allowed. D1 is the default database; schema, migrations, seeds, auth and tests are portable across D1/SQLite, PostgreSQL and MySQL, and provider APIs are supported through a single connection seam (`docs/DATABASES.md`).

Repository: https://github.com/claudio-silva/cloudflare-fullstack-starter

**Do not guess how this starter works.** Its procedures are in its own repository. Read them; don't improvise from memory.

## Step 1 — Get the reference

Clone the starter (with history and tags) to a temporary directory *outside* the user's project, and use the latest release tag unless the user asks for another:

```bash
git clone https://github.com/claudio-silva/cloudflare-fullstack-starter "$(mktemp -d)/starter"
# then, in that clone:
git checkout "$(git describe --tags --abbrev=0)"
```

Treat the clone as read-only reference material. Read `docs/AGENTS_SETUP.md` first.

## Step 2 — Pick the scenario

Inspect the working directory, then choose:

| Situation | What to do | Read |
|---|---|---|
| **A. Empty folder** (maybe only `.git`, `.cursor/`, `.claude/`) and the user wants a new app | Propose the starter, then install it | `docs/AGENTS_SETUP.md` → "Scenario A" |
| **B. Folder with existing files** (plans, specs, docs, assets) and the user wants a new app | Propose the starter, install **without overwriting** anything, merge conflicting files, reconcile with the user's plan | `docs/AGENTS_SETUP.md` → "Scenario B" |
| **C. Existing Node/web project** to convert to Cloudflare | Assess first, write a conversion plan, get approval, then port feature by feature | `docs/CONVERT_EXISTING_PROJECT.md` |
| **D. Project already built from the starter** (has a `starter` field in `package.json`, or the starter's file layout) and the user wants the latest improvements | Staged upgrade driven by the release log | `UPGRADING.md` (read the whole procedure and every entry between the project's version and the target) |

If the project looks starter-based but has **no** `starter.version`, it is an unversioned install: use the "Unversioned installs" section of `UPGRADING.md`.

## Ground rules

1. **Propose, then act.** Briefly say why the starter fits and what you are about to do, and check that the user accepts the tech stack the starter provides (React 19 + Vite + Tailwind + shadcn/ui, Hono, Better Auth, D1 by default) and, when converting an existing project, that it is compatible. Get a yes before installing, converting or upgrading. If the starter is not a good fit (not a React/Vite front end, heavy native dependencies, long-running servers, etc.), say so and discuss alternatives instead of forcing it.
   - A non-SQLite database, or a preference for a provider such as Supabase or Neon, is **not** a blocker. Read `docs/DATABASES.md` and choose a path with the user: D1 for auth plus the other store for domain data (usually best), or move auth to the other database too.
2. **Never overwrite user files.** Existing README, AGENTS.md, CLAUDE.md, `.gitignore`, `package.json` and plans are merged, not replaced.
3. **Work on a branch with a clean tree** for conversions and upgrades, and commit after each verified stage.
4. **Upgrade in stages**, following the release log order, verifying (`lint`, `tsc`, tests, build, local migrate) after each. Never skip a stage or edit an applied migration.
5. **Cloudflare-first, not Cloudflare-only.** Prefer Cloudflare services; if the user already uses another provider or prefers one, keep it behind an adapter (see `docs/EMAIL.md` for the pattern).
6. **Use the project's own tooling:** Node version from `.nvmrc`, the starter's `npm run` scripts (pnpm works too), `npm run init` for naming. After installing, follow the installed project's `AGENTS.md` for development conventions.
7. **Database work follows `docs/DATABASES.md`:** keep starter-owned database code portable (helpers `dbNow()`, `dbBool()`, `ignoreConflict()`), but do not restrict the user's own code: once their database is chosen they may use anything it supports. Add schema changes as an incremental migration *and* in the baseline, and when upgrading a project that has its own SQL migrations convert them as described in `UPGRADING.md` (3.0.0, stage 2) before touching remote databases.
8. **Report faithfully:** what was done, what was verified, and what remains manual (Cloudflare account steps, secrets, remote migrations, domain onboarding).
