# Converting an Existing Project to Cloudflare (with this starter)

For agents. The user has a working Node/web project and wants it running on Cloudflare. **Assess first, plan, get approval, then port feature by feature.** Do not start by copying files.

## 1. Assess (read-only)

Inventory the project and write the findings down:

| Question | Why it matters |
|---|---|
| Front end: React + Vite? Next.js? Vue? Plain HTML? | The starter is React 19 + Vite. React/Vite ports directly. Other frameworks mean rewriting the UI (confirm with the user) or choosing a different approach. |
| Back end: Express/Fastify/Koa/Nest? Serverless functions? | Handlers port to Hono routes (`src/worker/routes/*.ts`). Long-running processes, background threads and local file state do not fit Workers. |
| Database: Postgres/MySQL/Mongo/SQLite? ORM? | SQLite-compatible schemas port to D1 (Kysely). Others: convert the schema (SQL dialect differences, types, constraints) or keep the existing database reachable from Workers (e.g. Hyperdrive) and tell the user the trade-off. |
| Auth: own sessions, Passport, Auth0, Clerk...? | Starter ships Better Auth (email/password, Google). Decide: migrate users (password hashes may not be portable) or keep the existing provider. |
| File storage / uploads | R2 (or keep existing storage behind an adapter). |
| Scheduled jobs / queues / websockets | Cron triggers, Queues, Durable Objects. |
| Email / payments / other third-party services | Keep or replace. See adapter pattern below. |
| Native modules, `fs`, `child_process`, `sharp`, native bcrypt | Not available in Workers; find pure-JS or platform alternatives. Check `nodejs_compat` coverage. |
| Env vars and secrets | Move to `.env.<env>` files (secrets) and `wrangler.toml` vars (non-secret). |
| Tests, CI, deploy | Map to `npm test` (Vitest), Playwright, the starter CI and `deploy:*` scripts. |

If the project is a poor fit, say so and offer alternatives rather than forcing the starter.

## 2. Plan and get approval

Present a short plan to the user: what moves where, what is replaced, what is kept (and why), data migration approach, risks, and an order of work. **Cloudflare-first, not Cloudflare-only:** default to Cloudflare services when they fit (D1, R2, Email Service...), but if the user prefers to keep a third-party service, keep it behind an adapter (see `docs/EMAIL.md` for the pattern: interface in `src/worker/adapters/<service>/types.ts`, one file per implementation, registry in `index.ts`, selection in `src/config.ts`).

## 3. Set up on a branch

1. Work on a new git branch with a clean tree.
2. Install the starter following **Scenario B** in `AGENTS_SETUP.md` (existing files are kept and merged). Move the old application code into a `legacy/` folder (not deployed, excluded from lint/tsc) so it stays available for reference while porting; delete it at the end.
3. Run `init`, apply migrations, confirm the empty starter runs (`npm run dev`) and passes `npm run lint`, `npx tsc -b`, `npm test` before porting anything.

## 4. Port feature by feature

For each feature, in dependency order (schema, auth, API, UI):

- **Schema:** add numbered SQL files in `migrations/` (never edit applied ones) and update `src/worker/types/database.ts`.
- **API:** one module per feature in `src/worker/routes/`, mounted in `src/worker/index.ts`; protect with `authMiddleware`.
- **UI:** pages in `src/react-app/pages/`, routes in `App.tsx`. Use the bundled shadcn/ui components first.
- **Services:** put swappable services behind adapters.
- **Tests:** add a Vitest test per ported endpoint (`test/`), and extend the Playwright smoke test for key journeys.
- Verify and commit after each feature.

## 5. Data migration

Export from the old database, transform to D1-compatible SQL, import with `npm run db:seed` (idempotent seeds) or a one-off script. Rehearse locally, then on preview, then production (`db:backup:production` first).

## 6. Finish

Remove `legacy/`, update the README and `AGENTS.md` for the converted project, set secrets for preview/production (`BETTER_AUTH_SECRET`, `CLI_API_KEY`, adapter keys), follow the "Cloudflare account checklist" in `AGENTS_SETUP.md`, deploy preview first. Report what was converted, what is verified, and what remains manual.
