import { Command, Option } from "commander";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { basename, resolve } from "node:path";
import { createInterface } from "node:readline";
import { applyRestore, prepareRestore, readBackup, writeBackup } from "../src/cli/utils/backup";
import { connectToDatabase, getApiBaseUrl, type CliDatabaseClient } from "../src/cli/utils/db";
import { resolveBuildInfo } from "./lib/build-info";

type DbEnvironment = "local" | "preview" | "production";

const program = new Command();

const allowedEnvironments: DbEnvironment[] = ["local", "preview", "production"];
const commandTimeoutMs = 180_000;
const backupExtension = ".backup.jsonl";
const defaultArchiveDir = resolve(process.cwd(), ".wrangler", "backups");

function getDatabaseName(env: DbEnvironment): string {
	const wranglerPath = resolve(process.cwd(), "wrangler.toml");
	if (!existsSync(wranglerPath)) {
		throw new Error("wrangler.toml not found. Run this command from the project root.");
	}
	const content = readFileSync(wranglerPath, "utf8");

	let pattern: RegExp;
	if (env === "local") {
		pattern = /\[\[d1_databases\]\][^[]*database_name\s*=\s*"([^"]+)"/s;
	} else if (env === "preview") {
		pattern = /\[\[env\.preview\.d1_databases\]\][^[]*database_name\s*=\s*"([^"]+)"/s;
	} else {
		pattern = /\[\[env\.production\.d1_databases\]\][^[]*database_name\s*=\s*"([^"]+)"/s;
	}

	const match = content.match(pattern);
	if (!match?.[1]) {
		throw new Error(
			`Could not find D1 database_name for environment '${env}' in wrangler.toml. Ensure [[d1_databases]] (or [[env.${env}.d1_databases]]) is configured.`,
		);
	}
	return match[1];
}

function runWrangler(args: string[]): void {
	execFileSync("wrangler", args, {
		stdio: "inherit",
		env: process.env,
		timeout: commandTimeoutMs,
	});
}

function formatTimestampForFilename(date = new Date()): string {
	const y = date.getFullYear().toString().padStart(4, "0");
	const m = (date.getMonth() + 1).toString().padStart(2, "0");
	const d = date.getDate().toString().padStart(2, "0");
	const hh = date.getHours().toString().padStart(2, "0");
	const mm = date.getMinutes().toString().padStart(2, "0");
	const ss = date.getSeconds().toString().padStart(2, "0");
	return `${y}${m}${d}-${hh}${mm}${ss}`;
}

function resolveArchiveDir(archiveDir?: string): string {
	const target = archiveDir?.trim() || defaultArchiveDir;
	return resolve(process.cwd(), target);
}

function joinArchivePath(archiveDir: string, filePath: string): string {
	return resolve(archiveDir, filePath);
}

function sortByFileDateAsc(fileA: string, fileB: string): number {
	try {
		const statsA = statSync(fileA);
		const statsB = statSync(fileB);
		const diff = statsA.mtimeMs - statsB.mtimeMs;
		return diff !== 0 ? diff : statsA.ctimeMs - statsB.ctimeMs;
	} catch {
		return fileA.localeCompare(fileB);
	}
}

function inferBackupEnvironment(fileName: string): DbEnvironment {
	if (fileName.includes("-preview-")) {
		return "preview";
	}
	if (fileName.includes("-production-")) {
		return "production";
	}
	return "local";
}

function listBackupFiles(env: DbEnvironment = "local", archiveDir?: string): string[] {
	const backupDir = resolveArchiveDir(archiveDir);
	if (!existsSync(backupDir)) {
		return [];
	}

	const files = readdirSync(backupDir)
		.filter((name) => name.endsWith(backupExtension))
		.filter((name) => inferBackupEnvironment(name) === env)
		.map((name) => resolve(backupDir, name))
		.filter((filePath) => {
			try {
				return statSync(filePath).isFile();
			} catch {
				return false;
			}
		})
		.sort(sortByFileDateAsc);

	return files;
}

function deleteBackupFiles(files: string[]): { deleted: string[]; failed: string[] } {
	const deleted: string[] = [];
	const failed: string[] = [];

	for (const file of files) {
		try {
			unlinkSync(file);
			deleted.push(file);
		} catch {
			failed.push(file);
		}
	}

	return { deleted, failed };
}

function askYesNo(message: string): Promise<boolean> {
	return new Promise((resolve) => {
		const rl = createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		rl.question(`${message} [y/N] `, (answer) => {
			rl.close();
			const normalized = answer.trim().toLowerCase();
			resolve(normalized === "y" || normalized === "yes");
		});
	});
}

function isTimestampValue(value: string): boolean {
	return /^\d{10}(\.\d+)?$/.test(value) || /^\d{13}(\.\d+)?$/.test(value);
}

function isHumanDateTime(value: string): boolean {
	return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value);
}

function parseTimestamp(raw: string): string {
	if (!raw?.trim()) {
		throw new Error("A timestamp value is required.");
	}
	const normalized = raw.trim();

	if (isTimestampValue(normalized)) {
		return normalized;
	}

	const dateInput = isHumanDateTime(normalized) ? normalized.replace(" ", "T") : normalized;
	const parsed = Date.parse(dateInput);
	if (Number.isNaN(parsed)) {
		throw new Error(
			`Invalid timestamp format: "${raw}". Use unix seconds or RFC3339 (2026-04-23T10:00:00.000Z) or human format YYYY-MM-DD HH:MM:SS.`,
		);
	}

	return new Date(parsed).toISOString();
}

function getProjectName(): string {
	try {
		const name = (JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as { name?: string }).name;
		return (name ?? "database").replace(/[^a-zA-Z0-9._-]/g, "-");
	} catch {
		return "database";
	}
}

/** `<project>-<env>-<timestamp><suffix>.backup.jsonl` inside the archive directory. */
function backupFilePath(env: DbEnvironment, archiveDir: string, suffix = ""): string {
	return resolve(archiveDir, `${getProjectName()}-${env}-${formatTimestampForFilename()}${suffix}${backupExtension}`);
}

function latestBackupFile(env: DbEnvironment, archiveDir?: string): string | null {
	// Safety copies taken by `restore` are not restore points to offer as "latest".
	const files = listBackupFiles(env, archiveDir).filter((file) => !basename(file).includes("-before-restore"));
	return files.at(-1) ?? null;
}

program
	.name("db")
	.description("Database operations: migrations, backups, restore, seeding (any supported database) and D1 time-travel.")
	.version("1.0.0");

const backupsCommand = new Command("backups")
	.description("List available database backup files.")
	.addOption(
		new Option("-e, --env <environment>", "Filter by backup environment (local by default).")
			.choices(allowedEnvironments)
			.default("local"),
	)
	.option("--archive-dir <path>", "Backups directory.")
	.addHelpText(
		"after",
		`
Examples:
  db backups
  db backups --env local
  db backups --env preview
  db backups --env production
  db backups --env local --archive-dir ./.my-backups
`,
	)
	.action((options: { env?: DbEnvironment; archiveDir?: string }) => {
		const env = options.env ?? "local";
		const archiveDir = resolveArchiveDir(options.archiveDir);
		const backups = listBackupFiles(env, archiveDir);
		if (backups.length === 0) {
			console.log(`No backups found for environment: ${env}`);
			return;
		}
		console.log(`Backup directory: ${archiveDir}`);
		console.log("");
		for (const backup of backups) {
			console.log(`➤ ${basename(backup)}`);
		}
	});

backupsCommand.addCommand(
	new Command("clean")
		.description("Delete backup files for a specific environment.")
		.addOption(
			new Option("-e, --env <environment>", "Filter by backup environment (local by default).")
				.choices(allowedEnvironments)
				.default("local"),
		)
		.option("-a, --archive-dir <path>", "Backups directory.")
		.option("--all", "Delete all matching backup files without confirmation.")
		.option("--dry-run", "Show how many backup files would be deleted without deleting any.")
		.addHelpText(
			"after",
			`
Examples:
  db backups clean --env local
  db backups clean --env local --all
  db backups clean --env production --dry-run
  db backups clean --env production --archive-dir ./.my-backups --all
`,
		)
		.action(async (options: { env?: DbEnvironment; archiveDir?: string; all?: boolean; dryRun?: boolean }) => {
			const env = options.env ?? "local";
			const archiveDir = resolveArchiveDir(options.archiveDir);
			const backups = listBackupFiles(env, archiveDir);
			if (backups.length === 0) {
				console.log(`No backups found for environment: ${env}`);
				return;
			}

			if (options.dryRun) {
				console.log(`Dry run: ${backups.length} backup file(s) would be deleted for environment ${env} in ${archiveDir}.`);
				return;
			}

			let selected: string[] = [];
			if (options.all) {
				selected = backups;
			} else {
				for (const backup of backups) {
					const shouldDelete = await askYesNo(`Delete ${basename(backup)}?`);
					if (shouldDelete) {
						selected.push(backup);
					}
				}
			}

			if (selected.length === 0) {
				console.log("No backup files selected for deletion.");
				return;
			}

			const { deleted, failed } = deleteBackupFiles(selected);
			console.log(`Deleted ${deleted.length} backup file(s) for environment ${env}.`);
			if (failed.length > 0) {
				console.log(`Failed to delete ${failed.length} file(s):`);
				for (const file of failed) {
					console.log(`  - ${basename(file)}`);
				}
			}
		}),
);

program.addCommand(backupsCommand);

function describeApiFailure(env: DbEnvironment, error: unknown): never {
	const message = error instanceof Error ? error.message : String(error);
	const looksLikeConnection = /fetch failed|ECONNREFUSED|HTTP \d+|API key|CLI_API_KEY/i.test(message);
	const hint = !looksLikeConnection
		? ""
		: env === "local"
			? "\nIs the dev server running (npm run dev)? Local migrations also run automatically on the first API request."
			: `\nIs the Worker deployed with this version of the code, and CLI_API_KEY set in .env.${env}?`;
	console.error(`Database command failed: ${message}${hint}`);
	process.exit(1);
}

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** Workers Builds (WORKERS_CI) and other CI runners have an ephemeral disk. */
const isCi = () => Boolean(process.env.WORKERS_CI || process.env.CI);

/**
 * Block until the deployed Worker reports the version and commit of this checkout (`GET /api/`).
 * `wrangler deploy` can return a moment before every request is served by the new code, and an
 * old Worker would happily answer "nothing to apply" to a migration it does not know about.
 */
async function waitForDeploy(env: DbEnvironment, timeoutMs = 120_000): Promise<void> {
	const expected = resolveBuildInfo();
	const baseUrl = getApiBaseUrl(env);
	const deadline = Date.now() + timeoutMs;
	let seen = "no response";
	while (Date.now() < deadline) {
		try {
			const body = (await (await fetch(`${baseUrl}/api/`)).json()) as { version?: string; commit?: string };
			seen = `${body.version ?? "?"} (${body.commit ?? "?"})`;
			if (body.version === expected.version && body.commit === expected.commit) {
				console.log(`✓ ${baseUrl} serves ${seen}`);
				return;
			}
		} catch {
			seen = "no response";
		}
		await sleep(3_000);
	}
	throw new Error(
		`${baseUrl} still serves ${seen} after ${timeoutMs / 1000}s; expected ${expected.version} (${expected.commit}). Is the deploy finished?`,
	);
}

/** Recovery point before migrating: D1 Time Travel bookmark (remote) and/or a full backup file. */
async function takeSafetyNet(client: CliDatabaseClient, env: DbEnvironment, archiveDir?: string): Promise<void> {
	const remote = env !== "local";
	const ci = isCi();
	if (remote && (await client.backupInfo()).kind === "sqlite") {
		console.log(`Time Travel bookmark before migrating ${env} (restore: npm run db -- time-travel restore --env ${env} --bookmark <id>):`);
		try {
			runWrangler(["d1", "time-travel", "info", getDatabaseName(env), "--env", env]);
		} catch {
			console.warn("  (could not read the bookmark: the token needs D1 access; continuing)");
		}
	}
	if (remote && ci) {
		// A file written to a CI disk is gone when the build ends; do not pretend it is a backup.
		console.log("CI run: skipping the backup file (ephemeral disk).");
		return;
	}
	const file = backupFilePath(env, resolveArchiveDir(archiveDir), "-before-migrate");
	console.log(`Backing up ${env} before migrating: ${file}`);
	await writeBackup(client, env, file);
}

program.addCommand(
	new Command("migrate")
		.description("Apply pending migrations through the running Worker (portable Kysely migrations).")
		.addOption(
			new Option("-e, --env <environment>", "Target environment.")
				.choices(allowedEnvironments)
				.default("local"),
		)
		.option("--safe", "Take a recovery point first (Time Travel bookmark on D1, plus a full backup file outside CI).")
		.option("--wait-for-deploy", "Remote only: wait until the Worker serves this checkout's version and commit before migrating.")
		.option("-a, --archive-dir <path>", "Directory used to store migration backup.")
		.addHelpText(
			"after",
			`
Migrations run inside the Worker (POST /api/cli/migrate, protected by CLI_API_KEY), so the Worker
must already be deployed with the code that contains them: deploy first, then migrate.
Deploy commands run this for you. Nothing pending → no backup, no write. Local dev also
migrates automatically on the first API request.

Because the new code serves requests before the schema changes, write migrations additively
(add columns/tables; drop or rename in a later release) so the old and new code both work.

Examples:
  db migrate --env local        (dev server must be running)
  db migrate --env preview --safe
  db migrate --env production --safe --wait-for-deploy
`,
		)
		.action(async (options: { env: DbEnvironment; safe?: boolean; waitForDeploy?: boolean; archiveDir?: string }) => {
			const env = options.env;
			try {
				const client = await connectToDatabase(env);
				if (options.waitForDeploy && env !== "local") await waitForDeploy(env);
				const pending = (await client.migrations()).filter((m) => !m.applied);
				if (pending.length === 0) {
					console.log(`✓ No pending migrations for ${env}.`);
					return;
				}
				console.log(`Pending on ${env}: ${pending.map((m) => m.name).join(", ")}`);
				if (options.safe) await takeSafetyNet(client, env, options.archiveDir);
				const result = await client.migrate();
				console.log(`Migration mode: ${result.mode}`);
				console.log(result.applied.length ? `Applied: ${result.applied.join(", ")}` : "Nothing to apply.");
			} catch (error) {
				describeApiFailure(env, error);
			}
		}),
);

program.addCommand(
	new Command("migrations-list")
		.description("Show applied and pending migrations for an environment.")
		.addOption(
			new Option("-e, --env <environment>", "Target environment.")
				.choices(allowedEnvironments)
				.default("local"),
		)
		.addHelpText(
			"after",
			`
Examples:
  db migrations-list --env local
  db migrations-list --env production
`,
		)
		.action(async (options: { env: DbEnvironment }) => {
			try {
				const client = await connectToDatabase(options.env);
				for (const m of await client.migrations()) {
					console.log(`${m.applied ? "applied " : "pending "}  ${m.name}${m.executedAt ? `  (${m.executedAt})` : ""}`);
				}
			} catch (error) {
				describeApiFailure(options.env, error);
			}
		}),
);

program.addCommand(
	new Command("backup")
		.description("Back up the whole database (every table, not just auth) to a file, through the Worker.")
		.addOption(
			new Option("-e, --env <environment>", "Target environment.")
				.choices(allowedEnvironments)
				.default("local"),
		)
		.option("-o, --output <file>", "Destination file path. Defaults to .wrangler/backups/<project>-<env>-<timestamp>.backup.jsonl.")
		.option("-a, --archive-dir <path>", "Directory where the backup file is stored.")
		.addHelpText(
			"after",
			`
Works with every supported database (D1, PostgreSQL, MySQL): rows are read through the Worker
(/api/cli/backup/*, protected by CLI_API_KEY) and written to a JSON Lines file. The schema is not
included: it belongs to the migrations, and the file records which ones were applied.
Take backups while the app is quiet; for a point-in-time snapshot of a D1 database use time-travel.

Examples:
  db backup --env local        (dev server must be running)
  db backup --env production
  db backup --env preview --output ./tmp/preview.backup.jsonl
`,
		)
		.action(async (options: { env: DbEnvironment; output?: string; archiveDir?: string }) => {
			const env = options.env;
			const archiveDir = resolveArchiveDir(options.archiveDir);
			const output = options.output ? joinArchivePath(archiveDir, options.output) : backupFilePath(env, archiveDir);
			try {
				const client = await connectToDatabase(env);
				console.log(`Backing up ${env} to ${output}`);
				const { tables, rows } = await writeBackup(client, env, output);
				console.log(`Done: ${rows} row(s) from ${tables} table(s).`);
			} catch (error) {
				describeApiFailure(env, error);
			}
		}),
);

program.addCommand(
	new Command("restore")
		.description("Replace the database contents with a backup made by `db backup`, through the Worker.")
		.addOption(
			new Option("-e, --env <environment>", "Target environment.")
				.choices(allowedEnvironments)
				.default("local"),
		)
		.option("-f, --file <path>", "Path to the backup file (relative to the archive directory).")
		.option("-a, --archive-dir <path>", "Directory where backup files are stored.")
		.option("--latest", "Use the latest backup from the archive directory for this environment.")
		.option("-y, --yes", "Do not ask for confirmation (required in non-interactive shells for remote environments).")
		.option("--no-safety-backup", "Do not back up the current contents before replacing them.")
		.addHelpText(
			"after",
			`
Replaces ALL data in every table. Before touching anything the backup file is verified, the database
is checked to be at the same schema version, and (unless --no-safety-backup) the current contents are
saved to a "-before-restore" backup you can restore from if something goes wrong. A fresh, unmigrated
database is migrated first. The restore is not atomic: if it stops half-way, restore the safety backup.

Examples:
  db restore --env local --latest
  db restore --env local --file local-backup.backup.jsonl
  db restore --env production --file prod.backup.jsonl --yes
`,
		)
		.action(async (options: { env: DbEnvironment; file?: string; latest?: boolean; archiveDir?: string; yes?: boolean; safetyBackup: boolean }) => {
			const env = options.env;
			const archiveDir = resolveArchiveDir(options.archiveDir);
			if (!options.file && !options.latest) {
				throw new Error("Either --file or --latest is required.");
			}
			if (options.file && options.latest) {
				throw new Error("Use either --file or --latest, not both.");
			}
			const file = options.file ? joinArchivePath(archiveDir, options.file) : latestBackupFile(env, archiveDir);
			if (!file) {
				throw new Error(`No backup file found for environment ${env}. Provide --file or create a backup first.`);
			}

			let safetyFile: string | undefined;
			try {
				const { header, counts } = await readBackup(file);
				const client = await connectToDatabase(env);
				const { info, warnings } = await prepareRestore(client, header);
				for (const warning of warnings) console.warn(`Warning: ${warning}`);
				const rowTotal = Object.values(counts).reduce((a, b) => a + b, 0);
				console.log(
					`Restoring ${basename(file)} (taken ${header.createdAt} from ${header.environment}, ${rowTotal} row(s)) into ${env}.\nThis REPLACES all data in ${info.tables.length} table(s).`,
				);
				if (env !== "local" && !options.yes) {
					if (!process.stdin.isTTY) {
						throw new Error("Refusing to restore a remote environment without confirmation. Pass --yes.");
					}
					if (!(await askYesNo("Continue?"))) {
						console.log("Aborted.");
						return;
					}
				}
				if (options.safetyBackup) {
					safetyFile = backupFilePath(env, archiveDir, "-before-restore");
					console.log(`Saving the current contents first: ${safetyFile}`);
					await writeBackup(client, env, safetyFile);
				}
				await applyRestore(client, file, counts, info);
				console.log("Restore complete.");
			} catch (error) {
				if (safetyFile && existsSync(safetyFile)) {
					console.error(`The database may be partially restored. Its previous contents are in ${safetyFile}; run: db restore --env ${env} --file ${safetyFile}`);
				}
				describeApiFailure(env, error);
			}
		}),
);

program.addCommand(
	new Command("seed")
		.description("Run a registered seed (idempotent TypeScript, src/worker/db/seeds) through the Worker.")
		.addOption(
			new Option("-e, --env <environment>", "Target environment.")
				.choices(allowedEnvironments)
				.default("local"),
		)
		.option("-f, --file <name>", "Seed name as registered in src/worker/db/seeds/index.ts. If only one exists it is used automatically.")
		.addHelpText(
			"after",
			`
Seeds are NOT tracked and must be idempotent. They are portable across databases
because they use the Kysely query builder.

Examples:
  db seed --env local
  db seed --env preview --file admin-bootstrap
`,
		)
		.action(async (options: { env: DbEnvironment; file?: string }) => {
			try {
				const client = await connectToDatabase(options.env);
				const available = await client.listSeeds();
				if (available.length === 0) {
					throw new Error("No seeds are registered. Add one in src/worker/db/seeds/ and register it in index.ts.");
				}
				const name = options.file?.replace(/\.(ts|sql)$/, "") ?? (available.length === 1 ? available[0] : undefined);
				if (!name) {
					console.error("Multiple seeds found. Specify one with --file:");
					for (const seedName of available) console.error(`  ${seedName}`);
					process.exit(1);
				}
				await client.runSeed(name);
				console.log(`Seed '${name}' applied.`);
			} catch (error) {
				describeApiFailure(options.env, error);
			}
		}),
);

const timeTravelCommand = new Command("time-travel")
	.description("Use Cloudflare D1 Time Travel to inspect and restore historical database state.")
	.addOption(
		new Option("-e, --env <environment>", "Target remote environment.")
			.choices(["preview", "production"])
			.default("preview"),
	)
	.addHelpText(
		"after",
		`
Use:
  db time-travel info --env preview
  db time-travel restore --env production --timestamp "2026-04-23 10:00:00"
`,
	);

timeTravelCommand.addCommand(
	new Command("info")
		.description("Show available Time Travel information for a point in time.")
		.option("-t, --timestamp <timestamp>", "Optional timestamp to inspect (unix seconds or RFC3339, e.g. 2026-04-23T10:00:00.000Z).")
		.addHelpText(
			"after",
			`
Examples:
  db time-travel info --env preview
  db time-travel info --env preview --timestamp "2026-04-23 10:00:00"
`,
		)
		.action((options: { timestamp?: string }, command) => {
			const parent = command.parent?.opts() as { env: Exclude<DbEnvironment, "local"> };
			const env = parent?.env ?? "preview";
			const timestamp = options.timestamp ? parseTimestamp(options.timestamp) : undefined;
			runWrangler([
				"d1",
				"time-travel",
				"info",
				getDatabaseName(env),
				"--env",
				env,
				...(timestamp ? ["--timestamp", timestamp] : []),
			]);
		}),
);

timeTravelCommand.addCommand(
	new Command("restore")
		.description("Restore a remote database to a timestamp or bookmark.")
		.option("-t, --timestamp <timestamp>", "Restore point (unix seconds or RFC3339, e.g. 2026-04-23 10:00:00).")
		.option("-b, --bookmark <bookmark>", "Restore bookmark returned by time-travel info.")
		.addHelpText(
			"after",
			`
Examples:
  db time-travel restore --env preview --timestamp "2026-04-23 10:00:00"
  db time-travel restore --env production --bookmark <bookmark-id>
`,
		)
		.action((options: { timestamp?: string; bookmark?: string }, command) => {
			const parent = command.parent?.opts() as { env: Exclude<DbEnvironment, "local"> };
			const env = parent?.env ?? "preview";
			const hasTimestamp = Boolean(options.timestamp);
			const hasBookmark = Boolean(options.bookmark);
			if (!hasTimestamp && !hasBookmark) {
				throw new Error("Either --timestamp or --bookmark is required.");
			}
			if (hasTimestamp && hasBookmark) {
				throw new Error("Use either --timestamp or --bookmark, not both.");
			}
			const timestamp = hasTimestamp ? parseTimestamp(options.timestamp as string) : undefined;

			runWrangler([
				"d1",
				"time-travel",
				"restore",
				getDatabaseName(env),
				"--env",
				env,
				...(timestamp ? ["--timestamp", timestamp] : []),
				...(hasBookmark ? ["--bookmark", options.bookmark!] : []),
			]);
		}),
);

program.addCommand(timeTravelCommand);

program.parse();
