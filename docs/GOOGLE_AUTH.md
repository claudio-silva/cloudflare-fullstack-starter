# Sign in with Google

> Off until you set it up, and then on everywhere the Worker has its credentials.
> One command does everything except the part Google keeps to itself.

```bash
npm run setup:google            # set it up, and check it
npm run setup:google -- --check # only check what is already configured
```

---

## Why there is a command at all

Creating the OAuth client cannot be automated. Google has no public API for a "Web application" client — the console is the only way — and the one API that came close, the IAP OAuth Admin API, is being shut down. So the console visit stays.

Everything around it is where the time actually went, and that is what the command does:

1. **works out every value to paste** — the origins and the redirect URIs of local, preview and production, taken from the project's own base URLs, with the callback path Better Auth actually serves (`/api/auth/callback/google`);
2. **verifies the result without a browser.** Google's authorization endpoint says whether the client exists and whether each redirect URI is registered; its token endpoint says whether the secret is right. Nobody signs in, no secret is sent to the first check, and no code is ever granted;
3. **writes the credentials** into each `.env.<env>`, turns `config.auth.enableGoogleAuth` on, and offers to sync the secrets to Cloudflare.

The checking is the half that saves the day you lose otherwise: `redirect_uri_mismatch` in a browser tells you something is wrong, not *which* of the three environments, and not whether the secret is the problem.

## What it costs you with Google

The starter asks for `openid email profile` and nothing else. With only those scopes Google requires **no app verification**, shows **no unverified-app warning**, applies **no hundred-user cap** and does not expire authorizations after seven days. One OAuth client covers every environment, because it takes several redirect URIs.

Anything beyond sign-in — reading a user's calendar, say — is a *sensitive* scope, and that is a different world: verification, a yearly security assessment for restricted scopes, and the user cap until it is granted. This feature deliberately stays on the free side of that line.

## Setting it up

```bash
npm run setup:google
```

It prints the exact values, then asks for the client id and secret:

| In the Google console | What to put there |
|---|---|
| Consent screen (once per project) | External; your app's name and your email. Leave the default scopes |
| Clients → Create client → **Web application** | one client for the whole project |
| Authorized JavaScript origins | the origin of each environment |
| Authorized redirect URIs | `<origin>/api/auth/callback/google` for each |

A worktree's dev server runs on a port of its own (`bin/worktree-dev`), and a redirect URI must match exactly — add that port's URI too when you work that way, or sign in with email and password there.

Then the command checks the pair and each URI, writes `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` into `.env.local`, `.env.preview` and `.env.production`, turns the feature on in `src/config.ts`, and offers to sync the two secrets to Cloudflare (`--sync` to do it without asking).

For automation: `--client-id`, `--client-secret`, `--yes`, `--dry-run`.

## Checking it afterwards

```bash
npm run setup:google -- --check
```

Reports, per environment, whether its redirect URI is registered and whether that environment has credentials at all; exits non-zero when something is certainly wrong. Worth running:

- after `npm run setup:domain` — the app's URL changed, so its redirect URI did;
- after `npm run setup:website` — the app moves to `app.<domain>`, which changes all of them (docs/WEBSITE.md, *Moving a live project*);
- in CI, if you want a broken sign-in to fail a build rather than a user.

## How the app decides to show the button

Two things have to be true, and the browser asks the **server** which, rather than reading the flag:

- `config.auth.enableGoogleAuth` in `src/config.ts`, and
- `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` in that environment's Worker.

`GET /api/` reports the conjunction as `googleAuth`, and `src/react-app/lib/auth-features.ts` reads it once per page load. So the button appears exactly where it works: a deployment whose secrets are not synced yet shows none, instead of one that locks up and does nothing — which reads as a bug in the app rather than as a step somebody has yet to take.

That is also why the starter ships with `enableGoogleAuth: false`: a new project should not show a feature it cannot perform.

## When it goes wrong

| What you see | What it is |
|---|---|
| `redirect_uri_mismatch` in the browser | that environment's URI is not registered. `--check` says which one |
| The button does not appear | the Worker has no credentials there — sync them (`npx tsx bin/sync-secrets.ts production`), or the flag is off |
| `The OAuth client was not found` | wrong client id, or the client was deleted in the console |
| `The provided client secret is invalid` | right client, wrong secret |
| Sign-in works locally, not in production | almost always the production redirect URI, or secrets not synced. `--check` tells the two apart |

## Files

```
bin/setup-google.ts            # the command
bin/lib/google-oauth.ts        # what to tell Google, and how to read its answers (unit-tested)
src/react-app/lib/auth-features.ts   # what the browser asks the server
src/worker/middleware/auth.ts  # where the provider is registered, credentials permitting
```
