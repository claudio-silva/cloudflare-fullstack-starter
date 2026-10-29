# Dependencies

Why each third-party package is here, what it replaced, and when to look at the choice again. Read this before adding, swapping or reintroducing a dependency, and record the decision here when you make one.

## Contents

- [Policy](#policy)
- [Starter choices](#starter-choices)
- [Project choices](#project-choices)

## Policy

Every dependency of the starter is copied into every project built on it. Each one brings:

- **Weight:** install time, disk, and for runtime packages, bundle size.
- **Exposure:** its whole transitive tree is code you run, and a vulnerability anywhere in it is yours.
- **Maintenance:** another source of Dependabot PRs, peer-dependency conflicts and breaking majors.

So before adding a package, check:

1. **Is it already covered?** By the platform (Web APIs, Workers runtime, Node), or by a package already installed.
2. **How big is its tree?** `npm explain <pkg>` and `npm ls <pkg> --all` show what it pulls in. A small package with a large tree is a large package.
3. **Runtime or tooling?** Runtime packages ship to users; dev-only ones do not, but still run on every machine and CI job.
4. **Is it maintained?** Recent releases, open issues, and a single maintainer or not.
5. **Is the cost in proportion to the job?** A heavy tool for a peripheral task (a transpiler only to lint, a charting library for one figure) needs a strong reason.

None of this forbids a package. A project that genuinely needs something the starter dropped, or chose not to include, adds it and writes down why under [Project choices](#project-choices).

Each entry below has the same shape:

- **Choice:** what is used.
- **Why:** the reason, in terms of the policy above.
- **Rejected:** the alternatives considered.
- **Revisit when:** the change that would reopen the decision.

## Starter choices

### React lint rules: `eslint-plugin-react-x`

- **Choice:** `eslint-plugin-react-x` (`recommended-typescript`, plus the stricter `set-state-in-effect`, `purity`, `refs`, `immutability` and `globals` rules). Configured in `eslint.config.js`.
- **Why:** the official `eslint-plugin-react-hooks` (v6+) runs the React Compiler's analysis, which loads Babel: 16 `@babel/*` packages and `hermes-parser`, only to lint. That makes lint slower, adds a transpiler's worth of code to audit, and a steady stream of Dependabot updates. `react-x` works on the TypeScript AST that `typescript-eslint` already builds, has no Babel in its tree, and covers the same ground (`rules-of-hooks`, `exhaustive-deps`, `set-state-in-effect`, purity, refs) plus more: keys, context values, APIs that React 19 replaced.
- **Rejected:** `eslint-plugin-react-hooks` (Babel, see above); `eslint-plugin-react` (legacy rule set, many rules overlap with TypeScript).
- **Revisit when:** the official plugin stops depending on Babel, or the project adopts the React Compiler itself (then Babel is in the build anyway, and the official plugin costs nothing extra).

### TypeScript held at 6.x

- **Choice:** `typescript` pinned to 6.0.x. Dependabot ignores its major updates (`.github/dependabot.yml`).
- **Why:** `typescript-eslint` declares the peer `typescript >=4.8.4 <6.1.0`. A newer TypeScript breaks `npm install` without `--legacy-peer-deps`, or lints with an unsupported parser.
- **Rejected:** forcing the upgrade with overrides.
- **Revisit when:** `typescript-eslint` widens its peer range. Remove the Dependabot ignore at the same time.

### `@types/node` follows Node 24 LTS

- **Choice:** `@types/node` on the major of the Node line the project runs on (`.nvmrc`, `engines`). Dependabot ignores its major updates.
- **Why:** types for a newer Node than the one installed let code compile against APIs that are not there at runtime.
- **Revisit when:** the project moves to the next Node LTS. Bump `.nvmrc`, `engines` and `@types/node` together.

### Web framework, auth, database, validation: Hono, Better Auth, Kysely, zod

- **Choice:** `hono` (routing and middleware), `better-auth` (sessions, email/password, verification), `kysely` + `kysely-d1` (typed SQL), `zod` (validation at API boundaries, shared with forms).
- **Why:** all four run on Workers without Node polyfills and have small trees. Kysely keeps SQL portable across D1, PostgreSQL and MySQL (see `docs/DATABASES.md`) without an ORM's runtime or code generation.
- **Rejected:** Express (built for Node, not Workers); an ORM such as Prisma or Drizzle (more runtime and abstraction than typed queries need); hand-rolled auth.
- **Revisit when:** one of them stops supporting Workers, or a project needs something they cannot do.

### Password hashing: `bcryptjs`

- **Choice:** `bcryptjs`, plugged into Better Auth's `password.hash` / `verify` and used by the CLI routes.
- **Why:** pure JavaScript, so it runs in Workers, where native `bcrypt` cannot.
- **Revisit when:** a better primitive is available in Workers. Changing it needs a rehash-on-sign-in path, since existing hashes are stored.

### HTTP client: none

- **Choice:** `fetch`, wrapped by the starter's HTTP layer (`src/react-app/lib/http/`).
- **Why:** the layer already gives what a client library would: central error handling, holding and resending on lost connections, idempotency keys, version checks. A library would duplicate it and add a second place where errors are handled.
- **Rejected:** `axios`, `ky`, `ofetch`.
- **Revisit when:** not expected.

### Localisation: no i18n library

- **Choice:** the starter's own `t()` in `src/react-app/lib/i18n.ts`, with `setTranslator()` and `overrideMessages()`.
- **Why:** the starter has a few dozen strings of its own. A library would be imposed on every project, whether it needs translation or not.
- **Rejected:** `i18next` / `react-i18next`, `react-intl`, imposed by the starter.
- **Revisit when:** the starter's own strings outgrow `t()`. A project that needs real translation plugs in its library of choice through `setTranslator()`, and records that here.

### Error monitoring: no SDK

- **Choice:** the starter's client error reporting (`POST /api/client-errors`, written to the Worker logs).
- **Why:** it puts browser failures next to the server's in the logs the project already has, with no SDK in the bundle and no third party receiving user data.
- **Rejected:** Sentry and similar, as a default.
- **Revisit when:** a project needs alerting, grouping or release tracking beyond the logs. It can add an SDK and turn the built-in reporting off (`config.http.reportClientErrors: false`).

### Build tooling: `tsx`, `smol-toml`

- **Choice:** `tsx` runs the scripts in `bin/` without a build step. `smol-toml` reads `wrangler.toml` in `vite.config.ts` and `bin/lib/deploy-config.ts`.
- **Why:** both are small. `smol-toml` has no dependencies at all.
- **Rejected:** compiling `bin/` first (an extra step for every script).
- **Revisit when:** Node runs TypeScript directly for everything `bin/` uses. `tsx` could then go.

### End-to-end tests: Playwright, Chromium only

- **Choice:** `@playwright/test` with a single `chromium` project (`playwright.config.ts`).
- **Why:** the smoke test checks that the app works, not browser compatibility. One browser keeps the download and CI time small.
- **Revisit when:** a project needs cross-browser coverage. Add `firefox` / `webkit` projects in its own config.

### UI components: shadcn/ui, Radix-only set installed

- **Choice:**
  - Components whose only dependencies are `radix-ui`, `cn` and `class-variance-authority` are installed in `src/react-app/components/ui/`, plus `command` (`cmdk`) and `form` (`react-hook-form`, also used by the auth pages).
  - They are installed as the shadcn CLI writes them, from the `radix-ui` package (one package instead of one per primitive) and `cn` (shadcn's class merger, replacing `clsx` + `tailwind-merge`).
  - Components that need a heavier library are not installed. They are added on demand with `npx shadcn add <name>`:
    - `chart` (`recharts`)
    - `carousel` (`embla-carousel-react`)
    - `drawer` (`vaul`)
    - `calendar` (`react-day-picker`)
    - `input-otp` (`input-otp`)
    - `resizable` (`react-resizable-panels`)
    - `combobox` (`@base-ui/react`)
    - `message-scroller` (`@shadcn/react`)
  - Toasts come from `sonner` directly, mounted in `main.tsx`. shadcn's `ui/sonner` wrapper is not installed, because it adds `next-themes` only to read a theme the starter's provider already knows.
- **Why:** all of the heavy components were installed before, and none were used. Together they pulled in charting, carousel and date libraries for every project. The catalogue and install commands are in `docs/SHADCN_COMPONENTS.md`, so an agent still knows what exists.
- **Rejected:** installing the whole catalogue (the bloat above); a component library with its own runtime, such as MUI or Chakra (shadcn components are source in the project, styled with Tailwind, and only what is used is shipped).
- **Revisit when:** a heavy component turns out to be needed by most projects.

## Project choices

> Record here the dependencies this project adds, swaps or reintroduces, in the same format. Upgrades of the starter do not touch this section.
