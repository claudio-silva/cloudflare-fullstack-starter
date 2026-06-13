# Clear Dependabot backlog

Clear the open Dependabot PRs for this repo the fast way: instead of merging the
conflicting per-package PRs one by one, do a single conservative dependency
refresh on `main`, verify it compiles, push, and let Dependabot auto-close the
PRs it now considers satisfied.

Follow these steps in order. Stop and report if any step fails unexpectedly.

## 1. Pre-flight

- Confirm the working tree is clean and you're on `main` (or ask which branch to use).
  Run `git fetch origin` and make sure local `main` is up to date with `origin/main`.
- Select the project's Node version. This repo sets `engine-strict=true` in `.npmrc`,
  so the wrong Node version makes every `npm` command fail with `EBADENGINE`. Use:
  ```bash
  export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use   # reads .nvmrc
  ```
  If that exact version isn't installed, use the closest installed version that
  satisfies `engines.node` in `package.json`, and prefix every `npm`/`npx` command
  with the nvm load line above (env may not persist between shells).
- List what you're about to clear:
  ```bash
  gh pr list --state open --author "app/dependabot" --json number,title,mergeable --limit 100
  ```

## 2. Conservative dependency refresh

- `npm update` — bumps everything within the existing semver ranges in `package.json`
  (updates `package-lock.json` only; it must NOT change the version ranges in
  `package.json`). This resolves most transitive/security and minor PRs at once.
- `npm audit fix` — applies remaining non-breaking security fixes.
  Do NOT run `npm audit fix --force`: it can DOWNGRADE deps (e.g. wrangler) or jump
  majors. If the only available fix is `--force` (common for the
  `undici`/`ws` advisories that live under `miniflare`/`wrangler`), leave those
  advisories in place and note them — there is no forward, non-breaking fix yet.
- For directly-pinned deps (exact version, no `^`) that still have an open PR,
  bump them in `package.json` to the latest version **within the current major**,
  preserving the repo's exact-pin style, then run `npm install`. Do NOT bump across
  a major version without explicit confirmation from the user.

## 3. Verify it compiles (same gate as `.github/workflows/ci.yml`)

Run all of these and make sure they pass:
```bash
npm ci          # lockfile must be in sync, clean install
npm run lint    # eslint .
npx tsc --noEmit
npm run build   # tsc -b && vite build
```
If a dependency bump surfaces NEW type errors (e.g. a Hono/Kysely upgrade tightening
types), fix them with the smallest, safe change that preserves behavior (guard
clauses, narrowing) rather than reverting the bump — unless the bump is clearly not
worth it, in which case pin that one dependency back and explain why.

## 4. Push (DESTRUCTIVE — confirm first)

Summarize what changed (deps bumped, advisories resolved, any left behind, code
fixes) and ask the user to confirm before pushing. Then:
```bash
git add -A
git commit -m "chore(deps): refresh dependencies to clear Dependabot backlog"
git push origin main   # or open a PR if the user prefers
```

## 5. Close the now-satisfied PRs

After the push, Dependabot re-evaluates and auto-closes PRs whose target is now met
(this can take a few minutes). Sweep any stragglers, but first re-list to confirm
which ones are genuinely obsolete (`main` already at/above their target):
```bash
gh pr list --state open --author "app/dependabot" --json number,title --limit 100
# Close the obsolete ones (review the list first):
gh pr close <number> --comment "Superseded by dependency refresh on main."
```
Report a final summary: which PRs closed, which (if any) remain open and why.

## Guardrails
- Use `trash`, never `rm`, if you remove any file.
- Never use `npm audit fix --force` or bump a major version without explicit OK.
- Never force-push to `main`.
