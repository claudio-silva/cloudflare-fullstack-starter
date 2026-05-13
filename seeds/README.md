# Seeds

This directory contains SQL seed files for bootstrapping data into your D1 database.

## Seeds vs Migrations

| | Migrations | Seeds |
|---|---|---|
| **Purpose** | Schema changes (tables, columns, indexes) | Data bootstrapping (initial rows, config) |
| **Tracked** | Yes — recorded in `d1_migrations` table | No — run manually whenever needed |
| **Must be idempotent** | No | **Yes** |
| **Run automatically** | On `npm run db:migrate:*` | Only when you run `npm run db:seed` |

## File Naming Convention

```
seeds/
  admin-bootstrap.sql    # generic: applies to any env
  local-dev-data.sql     # env-specific: for local only
```

There's no enforced naming scheme, but `<env>-<description>.sql` is a useful convention for env-specific seeds.

## Running Seeds

```bash
# Run a specific seed against local D1
npm run db:seed -- --env local --file admin-bootstrap.sql

# If only one .sql file exists in seeds/, it's picked automatically
npm run db:seed -- --env local

# Run against preview or production
npm run db:seed -- --env preview --file admin-bootstrap.sql
npm run db:seed -- --env production --file admin-bootstrap.sql

# Or use the shorthand scripts
npm run db:seed
npm run db:seed:preview
npm run db:seed:production
```

> **Note:** For remote environments (preview/production), the dev server does not need to be running. However, you need to be logged in with Wrangler (`npx wrangler login`).

## Idempotency Requirement

Seeds **must be idempotent** — they must produce the same result whether run once or multiple times. Use `INSERT OR IGNORE`, `INSERT OR REPLACE`, or `ON CONFLICT DO NOTHING` clauses:

```sql
-- Good: idempotent insert
INSERT OR IGNORE INTO config (key, value) VALUES ('feature_x_enabled', 'false');

-- Also good
INSERT INTO config (key, value)
VALUES ('feature_x_enabled', 'false')
ON CONFLICT (key) DO NOTHING;
```

## Example: Admin Bootstrap Seed

```sql
-- seeds/admin-bootstrap.sql
-- Ensures a default config row exists (idempotent)
INSERT OR IGNORE INTO config (key, value, created_at)
VALUES ('onboarding_complete', 'false', unixepoch());
```
