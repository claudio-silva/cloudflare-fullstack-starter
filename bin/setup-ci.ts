#!/usr/bin/env tsx
/**
 * Connect this project to Cloudflare Workers Builds, so that a push to the
 * preview branch updates preview and `npm run deploy:production` releases to
 * production through CI. One command, safe to run again: each step checks first and
 * changes only what is missing or wrong.
 *
 * For each environment (preview first, then production):
 *   1. `.env.<env>`: created from `env/<env>.env.template` if missing; empty
 *      secrets generated; example.com URLs replaced by the workers.dev one;
 *      the D1 database found or created, when wrangler.toml holds a placeholder.
 *   2. The Worker: deployed for the first time if it does not exist. Preview
 *      with `deploy:preview`; production with `deploy:production --local`,
 *      which makes it the first release (asked first).
 *   3. The Workers Builds trigger: created, or corrected — branch, build and
 *      deploy commands.
 *   4. Build variables and Worker secrets synced.
 * Then:
 *   5. The production branch protected on GitHub: a ruleset requiring the
 *      GitHub Actions checks, so a release whose CI failed cannot reach it.
 *   6. `mode: "workers-builds"` in deploy.config.ts, for you to commit.
 *
 * Needs a user API token in .env.setup.local (CLOUDFLARE_API_TOKEN, with
 * Workers Scripts: Edit, D1: Edit, Workers CI: Edit), `gh` logged in, and an
 * `origin` on GitHub. The one step only a browser can do — installing the
 * Cloudflare GitHub app and the build token — is explained when it is missing.
 *
 * Usage: npm run setup:ci [-- --env preview|production] [--yes] [--dry-run]
 */

import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { parse as parseToml } from "smol-toml";
import { deployConfig } from "../deploy.config";
import { readCheckRuns, githubRepo } from "./lib/ci-checks";
import { cf, CloudflareApiError } from "./lib/cloudflare-api";
import { cloudflareCredentials, loadDeployConfig, parseEnvFile } from "./lib/deploy-config";
import {
	fillEnv,
	isPlaceholder,
	randomSecret,
	releaseRuleset,
	requiredCheckNames,
	RULESET_NAME,
	triggerDrift,
	triggerSettings,
	tokenTemplateUrl,
	withWorkersBuildsMode,
	type SetupEnv,
	type TriggerSettings,
} from "./lib/setup-ci";
import { resolveWorkerName } from "./lib/worker";

const SETUP_ENV_FILE = ".env.setup.local";
/** The template's own repository: a project that still points at it has not been given its own. */
const STARTER_REPO = "claudio-silva/cloudflare-fullstack-starter";
const GITHUB_APP_URL = "https://github.com/apps/cloudflare-workers-and-pages/installations/new";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const yes = args.includes("--yes") || args.includes("-y");
const onlyEnv = args.includes("--env") ? (args[args.indexOf("--env") + 1] as SetupEnv) : undefined;

let changes = 0;
const todo: string[] = [];

function step(message: string): void {
	console.log(`\n▸ ${message}`);
}
const ok = (message: string) => console.log(`  ✓ ${message}`);
const note = (message: string) => console.log(`  · ${message}`);
function change(message: string): void {
	changes++;
	console.log(`  ${dryRun ? "would" : "→"} ${message}`);
}

function die(message: string): never {
	console.error(`\nsetup:ci: ${message}`);
	process.exit(1);
}

function git(cmdArgs: string[]): string {
	return execFileSync("git", cmdArgs, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function gh<T>(path: string, method = "GET", body?: unknown): T {
	const out = execFileSync("gh", ["api", "-X", method, path, ...(body ? ["--input", "-"] : [])], {
		encoding: "utf-8",
		input: body ? JSON.stringify(body) : undefined,
		stdio: ["pipe", "pipe", "pipe"],
	});
	return (out ? JSON.parse(out) : null) as T;
}

/** Run another script of bin/, its output shown; false when it failed. */
function runScript(script: string, scriptArgs: string[]): boolean {
	console.log(`  $ tsx ${script} ${scriptArgs.join(" ")}`);
	// wrangler keeps its own login; the account id pins it to the account set up here.
	const env = { ...process.env, CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID || cloudflareCredentials().accountId };
	return spawnSync("npx", ["tsx", script, ...scriptArgs], { stdio: "inherit", env }).status === 0;
}

async function confirm(question: string): Promise<boolean> {
	if (yes) return true;
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	const answer = await new Promise<string>((done) => rl.question(`  ${question} [y/N] `, done));
	rl.close();
	return answer.trim().toLowerCase() === "y";
}

// --- Cloudflare ---------------------------------------------------------------

type Account = { token: string; accountId: string };

async function cloudflareAccount(): Promise<Account> {
	step("Cloudflare credentials");
	const { token, accountId: configured } = cloudflareCredentials();
	if (!token) {
		die(
			`no CLOUDFLARE_API_TOKEN (environment or ${SETUP_ENV_FILE}).\n\n` +
				`Create a user API token here — Workers Scripts and D1 are ticked; add "Workers CI: Edit" yourself:\n  ${tokenTemplateUrl()}\n` +
				`then put it in ${SETUP_ENV_FILE}:\n  CLOUDFLARE_API_TOKEN=...\nand run npm run setup:ci again.`,
		);
	}
	try {
		await cf(token, "GET", "/user/tokens/verify");
	} catch {
		die(`CLOUDFLARE_API_TOKEN is not a valid user API token (an account token or the Global API Key will not do). Create one: ${tokenTemplateUrl()}`);
	}

	let accountId = configured;
	if (!accountId) {
		const accounts = await cf<{ id: string; name: string }[]>(token, "GET", "/accounts").catch(() => []);
		if (accounts.length !== 1) {
			die(
				accounts.length
					? `the token reaches ${accounts.length} accounts; set CLOUDFLARE_ACCOUNT_ID in ${SETUP_ENV_FILE}:\n${accounts.map((a) => `  ${a.id}  ${a.name}`).join("\n")}`
					: `set CLOUDFLARE_ACCOUNT_ID in ${SETUP_ENV_FILE} (Workers & Pages → Account details).`,
			);
		}
		accountId = accounts[0].id;
		change(`CLOUDFLARE_ACCOUNT_ID=${accountId} (${accounts[0].name}) in ${SETUP_ENV_FILE}`);
		if (!dryRun) {
			const file = existsSync(SETUP_ENV_FILE) ? readFileSync(SETUP_ENV_FILE, "utf-8") : "";
			writeFileSync(SETUP_ENV_FILE, fillEnv(file, { CLOUDFLARE_ACCOUNT_ID: accountId }).content);
		}
	}

	// Each part of what setup:ci does, tried with a read the token needs for it.
	const missing: string[] = [];
	for (const [what, path] of [
		["Workers Scripts", `/accounts/${accountId}/workers/scripts`],
		["D1", `/accounts/${accountId}/d1/database?per_page=1`],
		["Workers CI", `/accounts/${accountId}/builds/tokens`],
	] as const) {
		await cf(token, "GET", path).catch(() => missing.push(what));
	}
	if (missing.length) {
		die(`the token cannot use ${missing.join(", ")} on account ${accountId}. Edit it in the dashboard (My Profile → API Tokens) to add ${missing.map((m) => `"${m}: Edit"`).join(", ")}.`);
	}
	ok(`token valid for account ${accountId}`);
	return { token, accountId };
}

type Script = { id: string; tag?: string };

async function workerTag(account: Account, name: string): Promise<string | undefined> {
	const scripts = await cf<Script[]>(account.token, "GET", `/accounts/${account.accountId}/workers/scripts`);
	return scripts.find((s) => s.id === name)?.tag;
}

type Trigger = TriggerSettings & {
	trigger_uuid: string;
	build_token_uuid: string;
	repo_connection: { repo_connection_uuid: string; repo_id: string };
};

const triggersOf = (account: Account, tag: string) =>
	cf<Trigger[]>(account.token, "GET", `/accounts/${account.accountId}/builds/workers/${tag}/triggers`);

// --- GitHub -------------------------------------------------------------------

type Repo = { fullName: string; id: number; ownerId: number; ownerLogin: string; name: string; private: boolean };

function githubRepository(): Repo {
	step("GitHub repository");
	let remote = "";
	try {
		remote = git(["remote", "get-url", "origin"]);
	} catch {
		die("no `origin` remote. Create the project's repository on GitHub and push main to it first.");
	}
	const fullName = githubRepo(remote);
	if (!fullName) die(`origin (${remote}) is not on GitHub. Workers Builds also takes GitLab.com, but connect it in the dashboard: see docs/DEPLOYMENT.md.`);
	if (fullName === STARTER_REPO && process.env.APP_VERSION_FROM !== "starter" && parseEnvFile(".env.production").APP_VERSION_FROM !== "starter") {
		die(`origin is the starter template itself (${STARTER_REPO}). Give the project its own repository first:\n  git remote rename origin starter && git remote add origin <your repo> && git push -u origin main`);
	}
	try {
		const r = gh<{ id: number; name: string; private: boolean; owner: { id: number; login: string } }>(`repos/${fullName}`);
		ok(`${fullName}${r.private ? " (private)" : ""}`);
		return { fullName, id: r.id, ownerId: r.owner.id, ownerLogin: r.owner.login, name: r.name, private: r.private };
	} catch {
		return die(`cannot read ${fullName} with \`gh\`. Install the GitHub CLI and run \`gh auth login\`.`);
	}
}

// --- Per environment ----------------------------------------------------------

function d1Name(env: SetupEnv): { name: string; id: string } | undefined {
	const toml = parseToml(readFileSync("wrangler.toml", "utf-8")) as { env?: Record<string, { d1_databases?: { binding: string; database_name: string; database_id: string }[] }> };
	const db = toml.env?.[env]?.d1_databases?.find((d) => d.binding === "DB");
	return db && { name: db.database_name, id: db.database_id };
}

/** Step 1: everything the deploy reads from `.env.<env>`, filled where nobody has. */
async function prepareEnvFile(account: Account, env: SetupEnv, workerName: string): Promise<void> {
	const file = `.env.${env}`;
	if (!existsSync(file)) {
		change(`create ${file} from env/${env}.env.template`);
		if (!dryRun) copyFileSync(`env/${env}.env.template`, file);
	}
	const current = existsSync(file) ? parseEnvFile(file) : {};
	const wanted: Record<string, string> = {};

	for (const key of ["BETTER_AUTH_SECRET", "CLI_API_KEY"]) {
		if (isPlaceholder(current[key])) wanted[key] = randomSecret();
	}
	const urlKey = `CLI_API_URL_${env.toUpperCase()}`;
	if (isPlaceholder(current.APP_BASE_URL) || isPlaceholder(current[urlKey])) {
		const { subdomain } = await cf<{ subdomain: string }>(account.token, "GET", `/accounts/${account.accountId}/workers/subdomain`).catch(() => ({ subdomain: "" }));
		if (!subdomain) die(`no workers.dev subdomain on this account yet: open Workers & Pages in the dashboard once to pick one, or set APP_BASE_URL and ${urlKey} in ${file} to your domain.`);
		const url = `https://${workerName}.${subdomain}.workers.dev`;
		if (isPlaceholder(current.APP_BASE_URL)) wanted.APP_BASE_URL = url;
		if (isPlaceholder(current[urlKey])) wanted[urlKey] = current.APP_BASE_URL && !isPlaceholder(current.APP_BASE_URL) ? current.APP_BASE_URL : url;
	}

	const db = d1Name(env);
	if (db && isPlaceholder(db.id) && isPlaceholder(current.D1_DATABASE_ID)) {
		const found = await cf<{ uuid: string; name: string }[]>(account.token, "GET", `/accounts/${account.accountId}/d1/database?name=${encodeURIComponent(db.name)}`);
		const existing = found.find((d) => d.name === db.name);
		if (existing) {
			note(`D1 database ${db.name} exists (${existing.uuid})`);
			wanted.D1_DATABASE_ID = existing.uuid;
		} else {
			change(`create D1 database ${db.name}`);
			wanted.D1_DATABASE_ID = dryRun
				? "<new>"
				: (await cf<{ uuid: string }>(account.token, "POST", `/accounts/${account.accountId}/d1/database`, { name: db.name })).uuid;
		}
	}

	if (Object.keys(wanted).length === 0) return ok(`${file} complete`);
	change(`set ${Object.keys(wanted).join(", ")} in ${file}`);
	if (!dryRun) writeFileSync(file, fillEnv(readFileSync(file, "utf-8"), wanted).content);
}

/** Step 2: the Worker exists, deployed once from here if it did not. */
async function ensureWorker(account: Account, env: SetupEnv, workerName: string): Promise<string | undefined> {
	const tag = await workerTag(account, workerName);
	if (tag) {
		ok(`Worker ${workerName} exists`);
		return tag;
	}
	if (env === "production") {
		change(`release production for the first time (npm run deploy:production -- --local), which creates ${workerName}`);
		if (dryRun) return undefined;
		if (!(await confirm("This releases the current main to production as its first version. Go ahead?"))) {
			todo.push("Release production once (`npm run deploy:production -- --local`), then run `npm run setup:ci` again.");
			return undefined;
		}
		if (!runScript("bin/deploy-production.ts", ["--local", "--yes"])) die("the first production release failed (above). Fix it and run npm run setup:ci again.");
	} else {
		change(`deploy preview for the first time (npm run deploy:preview), which creates ${workerName}`);
		if (dryRun) return undefined;
		if (!runScript("bin/deploy-pipeline.ts", ["--env", env])) die("the first preview deploy failed (above). Fix it and run npm run setup:ci again.");
	}
	return (await workerTag(account, workerName)) ?? die(`${workerName} still not found after its first deploy.`);
}

type Connection = { repoConnectionUuid: string; buildTokenUuid: string };

/** The repository connection and build token every trigger of this repo shares. */
async function buildConnection(account: Account, repo: Repo, tags: string[]): Promise<Connection | undefined> {
	for (const tag of tags) {
		const t = (await triggersOf(account, tag)).find((x) => x.repo_connection?.repo_id === String(repo.id));
		if (t) return { repoConnectionUuid: t.repo_connection.repo_connection_uuid, buildTokenUuid: t.build_token_uuid };
	}

	const tokens = await cf<{ build_token_uuid: string; build_token_name: string }[]>(account.token, "GET", `/accounts/${account.accountId}/builds/tokens`);
	const connect =
		"Open the Worker in the dashboard (Workers & Pages → the Worker → Settings → Builds → Connect), " +
		`pick ${repo.fullName}, leave "Create new token" selected and save; the settings you enter there do not matter, setup:ci corrects them. Then run npm run setup:ci again.`;
	if (tokens.length === 0) {
		todo.push(`Workers Builds needs a build token, which only the dashboard creates. ${connect}`);
		return undefined;
	}
	if (dryRun) {
		change(`connect ${repo.fullName} to Workers Builds`);
		return { repoConnectionUuid: "<new>", buildTokenUuid: tokens[0].build_token_uuid };
	}
	try {
		const conn = await cf<{ repo_connection_uuid: string }>(account.token, "PUT", `/accounts/${account.accountId}/builds/repos/connections`, {
			provider_type: "github",
			provider_account_id: String(repo.ownerId),
			provider_account_name: repo.ownerLogin,
			repo_id: String(repo.id),
			repo_name: repo.name,
		});
		change(`connect ${repo.fullName} to Workers Builds (build token "${tokens[0].build_token_name}")`);
		return { repoConnectionUuid: conn.repo_connection_uuid, buildTokenUuid: tokens[0].build_token_uuid };
	} catch (error) {
		if (error instanceof CloudflareApiError && error.codes.includes(8000008)) {
			todo.push(`Install the Cloudflare GitHub app on ${repo.ownerLogin} with access to ${repo.name}: ${GITHUB_APP_URL} — then run npm run setup:ci again.`);
			return undefined;
		}
		throw error;
	}
}

/** Step 3: the Worker's trigger, created or corrected. Returns whether it changed. */
async function ensureTrigger(account: Account, env: SetupEnv, tag: string, conn: Connection): Promise<boolean> {
	const branch = loadDeployConfig(env).branch;
	const wanted = triggerSettings(env, branch);
	const triggers = await triggersOf(account, tag);
	if (triggers.length > 1) {
		note(`${triggers.length} triggers on this Worker; leaving them as they are. Expected one: ${wanted.build_command} / ${wanted.deploy_command} on ${branch}.`);
		return false;
	}
	const [existing] = triggers;
	if (existing) {
		const drift = triggerDrift(existing, wanted);
		if (drift.length === 0) {
			ok(`trigger builds ${branch}: ${wanted.build_command} → ${wanted.deploy_command}`);
			return false;
		}
		change(`correct trigger (${drift.join(", ")}) → builds ${branch}: ${wanted.build_command} → ${wanted.deploy_command}`);
		if (!dryRun) await cf(account.token, "PATCH", `/accounts/${account.accountId}/builds/triggers/${existing.trigger_uuid}`, { ...wanted, trigger_name: existing.trigger_name });
		return true;
	}
	change(`create trigger → builds ${branch}: ${wanted.build_command} → ${wanted.deploy_command}`);
	if (!dryRun) {
		await cf(account.token, "POST", `/accounts/${account.accountId}/builds/triggers`, {
			...wanted,
			external_script_id: tag,
			repo_connection_uuid: conn.repoConnectionUuid,
			build_token_uuid: conn.buildTokenUuid,
		});
	}
	return true;
}

async function setupEnv(account: Account, repo: Repo, env: SetupEnv): Promise<void> {
	const workerName = resolveWorkerName("wrangler.toml", env);
	step(`${env} — Worker ${workerName}, branch ${loadDeployConfig(env).branch}`);
	await prepareEnvFile(account, env, workerName);
	const tag = await ensureWorker(account, env, workerName);
	if (!tag) return;

	const otherTags = (
		await Promise.all((["preview", "production"] as const).map((e) => workerTag(account, resolveWorkerName("wrangler.toml", e)).catch(() => undefined)))
	).filter((t): t is string => !!t);
	const conn = await buildConnection(account, repo, [tag, ...otherTags.filter((t) => t !== tag)]);
	if (!conn) return;
	const created = await ensureTrigger(account, env, tag, conn);

	if (dryRun) return note("build variables and secrets: synced on a real run");
	if (!runScript("bin/sync-build-vars.ts", [env, ...(created ? ["--force"] : [])])) die(`syncing the build variables of ${env} failed.`);
	if (!runScript("bin/sync-secrets.ts", [env])) die(`syncing the secrets of ${env} failed.`);

	const branch = loadDeployConfig(env).branch;
	if (env === "preview" && !git(["ls-remote", "--heads", "origin", branch])) {
		todo.push(`Create the preview branch, which Workers Builds watches: git push origin main:${branch}`);
	}
}

// --- GitHub protection and the mode -------------------------------------------

function protectReleases(repo: Repo): void {
	const branch = loadDeployConfig("production").branch;
	step(`GitHub — protect ${branch}`);
	try {
		gh(`repos/${repo.fullName}/branches/${branch}/protection`);
		return ok(`${branch} has branch protection already (left as it is)`);
	} catch {
		// Not protected, or no such branch yet: rulesets cover both.
	}
	const rulesets = gh<{ name: string }[]>(`repos/${repo.fullName}/rulesets`);
	if (rulesets.some((r) => r.name === RULESET_NAME)) return ok(`ruleset "${RULESET_NAME}" exists`);

	const runs = readCheckRuns(git(["rev-parse", "origin/main"])) ?? [];
	const checks = requiredCheckNames(runs);
	if (checks.length === 0) {
		todo.push(`Protect ${branch} once CI has run on main: push main, wait for GitHub Actions, run npm run setup:ci again.`);
		return note("no GitHub Actions checks on origin/main yet; cannot tell which ones to require");
	}
	change(`ruleset "${RULESET_NAME}": ${branch} accepts only commits that passed ${checks.join(", ")}`);
	if (dryRun) return;
	try {
		gh(`repos/${repo.fullName}/rulesets`, "POST", releaseRuleset(branch, checks));
	} catch (error) {
		const detail = String((error as { stderr?: string }).stderr ?? error);
		if (/403|Upgrade to GitHub Pro/i.test(detail) && repo.private) {
			todo.push(`GitHub protects branches of private repositories only on paid plans. ${branch} is unprotected: deploy:production still refuses a failed CI, but a push by hand would not be stopped.`);
		} else {
			todo.push(`Could not create the ruleset on ${branch} (${detail.trim().split("\n")[0]}). Add it in GitHub → Settings → Rules.`);
		}
	}
}

function setMode(): void {
	step("deploy.config.ts");
	if (loadDeployConfig("production").mode === "workers-builds") return ok('mode is "workers-builds"');
	if (deployConfig.mode === "workers-builds") return ok('mode is "workers-builds" (overridden in .env.production)');
	const source = readFileSync("deploy.config.ts", "utf-8");
	const updated = withWorkersBuildsMode(source);
	if (!updated) {
		todo.push('Set `mode: "workers-builds"` in deploy.config.ts by hand (the line was not recognised).');
		return;
	}
	change('set mode: "workers-builds"');
	if (!dryRun) writeFileSync("deploy.config.ts", updated);
	todo.push('Commit and push deploy.config.ts: CI deploys stay off until the "workers-builds" mode reaches main.');
}

async function main(): Promise<void> {
	if (args.includes("--help") || args.includes("-h")) {
		console.log("Usage: npm run setup:ci [-- --env preview|production] [--yes] [--dry-run]");
		return;
	}
	if (onlyEnv && onlyEnv !== "preview" && onlyEnv !== "production") die("--env takes preview or production");
	if (!existsSync(resolve("wrangler.toml"))) die("run it from the project root");
	if (dryRun) console.log("Dry run: nothing is changed.");

	const repo = githubRepository();
	const account = await cloudflareAccount();
	for (const env of onlyEnv ? [onlyEnv] : (["preview", "production"] as const)) await setupEnv(account, repo, env);
	if (!onlyEnv || onlyEnv === "production") protectReleases(repo);
	setMode();

	console.log(`\n${changes === 0 ? "Nothing to change: Workers Builds is set up." : dryRun ? `${changes} change(s) to make.` : `Done (${changes} change(s)).`}`);
	if (todo.length) console.log(`\nStill to do:\n${todo.map((t) => `  - ${t}`).join("\n")}`);
	else if (!dryRun) {
		console.log(`\nA push to ${loadDeployConfig("preview").branch} now updates preview; npm run deploy:production releases to production.`);
	}
}

main().catch((error: unknown) => die(error instanceof Error ? error.message : String(error)));
