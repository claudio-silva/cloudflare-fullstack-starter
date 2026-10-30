/**
 * The decisions of `npm run setup:ci`, kept apart from the API calls so they
 * can be tested: what a Workers Builds trigger should look like, which `.env`
 * values to fill in, how the release branch is protected.
 */
import { randomBytes } from "node:crypto";
import type { CheckRun } from "./ci-checks";

export type SetupEnv = "preview" | "production";

/** What setup:ci owns in a trigger. Other fields are left as they are. */
export type TriggerSettings = {
	trigger_name: string;
	build_command: string;
	deploy_command: string;
	root_directory: string;
	branch_includes: string[];
	branch_excludes: string[];
	path_includes: string[];
	path_excludes: string[];
	build_caching_enabled: boolean;
};

export function triggerSettings(env: SetupEnv, branch: string): TriggerSettings {
	return {
		trigger_name: `Deploy ${branch}`,
		build_command: `npm run build:${env}`,
		deploy_command: `npm run deploy:ci -- --env ${env}`,
		root_directory: "/",
		branch_includes: [branch],
		branch_excludes: [],
		path_includes: ["*"],
		path_excludes: [],
		build_caching_enabled: true,
	};
}

/** The settings of `existing` that differ from `wanted`; empty when it is already right. */
export function triggerDrift(existing: Partial<TriggerSettings>, wanted: TriggerSettings): string[] {
	// The name is cosmetic: one renamed in the dashboard is left alone.
	const keys = (Object.keys(wanted) as (keyof TriggerSettings)[]).filter((k) => k !== "trigger_name");
	return keys.filter((k) => JSON.stringify(existing[k] ?? null) !== JSON.stringify(wanted[k]));
}

/** A value nobody chose yet: empty, or the template's example.com. */
export function isPlaceholder(value: string | undefined): boolean {
	return !value || /(^|[./])example\.com\b/.test(value) || value.startsWith("YOUR_");
}

export const randomSecret = () => randomBytes(32).toString("base64url");

/**
 * Set `KEY=value` in the text of an env file: replaces the line of a key that
 * holds a placeholder, appends a key that is missing, and never touches a value
 * someone set — unless `overwrite`, which replaces any value that differs.
 * Returns the new text and the keys it changed.
 */
export function fillEnv(content: string, values: Record<string, string>, { overwrite = false } = {}): { content: string; changed: string[] } {
	const lines = content.split("\n");
	const changed: string[] = [];
	for (const [key, value] of Object.entries(values)) {
		const i = lines.findIndex((l) => l.trim().startsWith(`${key}=`));
		if (i === -1) {
			if (lines.length && lines[lines.length - 1] === "") lines.splice(lines.length - 1, 0, `${key}=${value}`);
			else lines.push(`${key}=${value}`);
			changed.push(key);
		} else {
			const current = lines[i].trim().slice(key.length + 1).replace(/^["']|["']$/g, "");
			if (overwrite ? current === value : !isPlaceholder(current)) continue;
			lines[i] = `${key}=${value}`;
			changed.push(key);
		}
	}
	return { content: lines.join("\n"), changed };
}

/** `deploy.config.ts` with `mode` set to `workers-builds`; null when the line is not found. */
export function withWorkersBuildsMode(source: string): string | null {
	const re = /^(\s*mode:\s*)"[a-z-]+"(\s+as DeployMode,)/m;
	return re.test(source) ? source.replace(re, `$1"workers-builds"$2`) : null;
}

/** GitHub Actions' app id, which pins required checks to it so no other app can satisfy them. */
export const GITHUB_ACTIONS_APP_ID = 15368;

/** Names of the GitHub Actions checks of a commit: what a release must have passed. */
export function requiredCheckNames(runs: CheckRun[]): string[] {
	return [...new Set(runs.filter((r) => r.app?.slug === "github-actions").map((r) => r.name))].sort();
}

export const RULESET_NAME = "Releases pass CI";

/**
 * A ruleset for the production branch: no push of a commit whose checks did
 * not pass, no force push, no deletion. Unlike classic branch protection it can
 * exist before the branch does, and `do_not_enforce_on_create: false` makes it
 * apply to the push that creates it, so the first release is gated too.
 */
export function releaseRuleset(branch: string, checks: string[]) {
	return {
		name: RULESET_NAME,
		target: "branch",
		enforcement: "active",
		bypass_actors: [],
		conditions: { ref_name: { include: [`refs/heads/${branch}`], exclude: [] } },
		rules: [
			{ type: "deletion" },
			{ type: "non_fast_forward" },
			{
				type: "required_status_checks",
				parameters: {
					strict_required_status_checks_policy: false,
					do_not_enforce_on_create: false,
					required_status_checks: checks.map((context) => ({ context, integration_id: GITHUB_ACTIONS_APP_ID })),
				},
			},
		],
	};
}

/**
 * The dashboard page that creates a user API token with what setup:ci needs
 * already ticked. Workers CI has no documented short key, so it is named in
 * the instructions instead (an unknown key is dropped silently).
 */
export function tokenTemplateUrl(): string {
	const keys = [
		{ key: "workers_scripts", type: "edit" },
		{ key: "d1", type: "edit" },
		{ key: "account_settings", type: "read" },
	];
	const q = encodeURIComponent(JSON.stringify(keys));
	return `https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=${q}&accountId=*&zoneId=all&name=${encodeURIComponent("setup:ci")}`;
}
