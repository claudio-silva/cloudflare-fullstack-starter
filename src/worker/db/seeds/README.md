# Seeds

Seeds are **idempotent TypeScript functions** that insert bootstrap data. They are registered in `index.ts`, never run automatically, and not tracked. See `docs/DATABASES.md` (Seeds) for an example.

```bash
npm run db:seed                                   # runs the only registered seed
npm run db:seed -- --env local --file <name>
npm run db:seed -- --env production --file <name>
```

Idempotency is required: use `ignoreConflict()` from `src/worker/db` (works on SQLite/D1, PostgreSQL and MySQL).
