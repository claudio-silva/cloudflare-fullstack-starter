import { Command, Option } from "commander";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { basename, resolve } from "node:path";
import { createInterface } from "node:readline";

type DbEnvironment = "local" | "preview" | "production";

const program = new Command();

const allowedEnvironments: DbEnvironment[] = ["local", "preview", "production"];
const commandTimeoutMs = 180_000;
const defaultArchiveDir = resolve(process.cwd(), ".wrangler", "backups");

function getDatabaseName(env: DbEnvironment): string {
	const wranglerPath = resolve(process.cwd(), "wrangler.toml");
	if (!existsSync(wranglerPath)) {
		throw new Error("wrangler.toml not found. Run this command from the project root.");
	}
	const content = readFileSync(wranglerPath, "utf8");

	let pattern: RegExp;
	if (env === "local") {
		pattern = /\[\[d1_databases\]\][^\[]*database_name\s*=\s*"([^"]+)"/s;
	} else if (env === "preview") {
		pattern = /\[\[env\.preview\.d1_databases\]\][^\[]*database_name\s*=\s*"([^"]+)"/s;
	} else {
		pattern = /\[\[env\.production\.d1_databases\]\][^\[]*database_name\s*=\s*"([^"]+)"/s;
	}

	const match = content.match(pattern);
	if (!match?.[1]) {
		throw new Error(
			`Could not find D1 database_name for environment '${env}' in wrangler.toml. Ensure [[d1_databases]] (or [[env.${env}.d1_databases]]) is configured.`,
		);
	}
	return match[1];
}

function getEnvFlags(env: DbEnvironment): string[] {
	if (env === "local") {
		return ["--local"];
	}
	return ["--env", env];
}

function getRemoteFlags(env: DbEnvironment): string[] {
	if (env === "local") {
		return [];
	}
	return ["--remote"];
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
		.filter((name) => name.endsWith(".sql"))
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

function resolveOutputPath(env: DbEnvironment, archiveDir?: string): string {
	const outputDir = resolveArchiveDir(archiveDir);
	if (!existsSync(outputDir)) {
		mkdirSync(outputDir, { recursive: true });
	}
	const dbName = getDatabaseName(env);
	return resolve(outputDir, `${dbName}-${env}-${formatTimestampForFilename()}.sql`);
}

function latestBackupFile(env: DbEnvironment, archiveDir?: string): string | null {
	const files = listBackupFiles(env, archiveDir);
	if (files.length === 0) {
		return null;
	}
	return files.at(-1) ?? null;
}

function getLocalStateDir(): string {
	return resolve(process.cwd(), ".wrangler", "state", "v3", "d1");
}

function collectLocalSqliteFiles(dirPath: string): string[] {
	const entries = readdirSync(dirPath, { withFileTypes: true });
	const files: string[] = [];

	for (const entry of entries) {
		const entryPath = resolve(dirPath, entry.name);
		if (entry.isDirectory()) {
			files.push(...collectLocalSqliteFiles(entryPath));
			continue;
		}

		if (entry.name.endsWith(".sqlite") && entry.name !== "metadata.sqlite" && !entry.name.includes("-restore-")) {
			files.push(entryPath);
		}
	}

	return files;
}

function isWritable(path: string): boolean {
	try {
		statSync(path);
		return true;
	} catch {
		return false;
	}
}

function uniqueBackupPath(fileName: string, archiveDir: string): string {
	const backupDir = archiveDir;
	if (!existsSync(backupDir)) {
		mkdirSync(backupDir, { recursive: true });
	}

	const baseName = basename(fileName, ".sqlite");
	const timestamp = formatTimestampForFilename(new Date());
	let attempt = 0;

	while (true) {
		const suffix = attempt === 0 ? "" : `-${attempt}`;
		const candidate = resolve(backupDir, `${baseName}-restore-${timestamp}${suffix}.sqlite`);
		if (!existsSync(candidate)) {
			return candidate;
		}
		attempt += 1;
	}
}

function resetLocalSqliteDbForRestore(archiveDir: string): string[] {
	const stateDir = getLocalStateDir();
	const backupTargets: string[] = [];

	if (!existsSync(stateDir)) {
		return backupTargets;
	}

	const sqliteFiles = collectLocalSqliteFiles(stateDir);
	if (sqliteFiles.length === 0) {
		return backupTargets;
	}

	for (const fileName of sqliteFiles) {
		const filePath = resolve(stateDir, fileName);
		if (!isWritable(filePath)) {
			continue;
		}

		const backupPath = uniqueBackupPath(fileName, archiveDir);
		renameSync(filePath, backupPath);
		backupTargets.push(backupPath);

		writeFileSync(filePath, "", "utf8");

		const walPath = `${filePath}-wal`;
		if (isWritable(walPath)) {
			const walBackup = `${backupPath}-wal`;
			renameSync(walPath, walBackup);
			backupTargets.push(walBackup);
		}

		const shmPath = `${filePath}-shm`;
		if (isWritable(shmPath)) {
			const shmBackup = `${backupPath}-shm`;
			renameSync(shmPath, shmBackup);
			backupTargets.push(shmBackup);
		}
	}

	return backupTargets;
}

program
	.name("db")
	.description("D1 database operations: migrations, backups, restore, time-travel, and seeding.")
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

program.addCommand(
	new Command("migrate")
		.description("Apply pending migrations for a D1 environment.")
		.addOption(
			new Option("-e, --env <environment>", "Target environment.")
				.choices(allowedEnvironments)
				.default("local"),
		)
		.option("--safe", "Take a backup before running migrations.")
		.option("-a, --archive-dir <path>", "Directory used to store migration backup.")
		.addHelpText(
			"after",
			`
Examples:
  db migrate --env local
  db migrate --env preview --safe
  db migrate --env production --safe
`,
		)
		.action((options: { env: DbEnvironment; safe?: boolean; archiveDir?: string }) => {
			const env = options.env;
			if (options.safe) {
				const output = resolveOutputPath(env, options.archiveDir);
				runWrangler([
					"d1",
					"export",
					getDatabaseName(env),
					...getEnvFlags(env),
					...getRemoteFlags(env),
					"--output",
					output,
					"--skip-confirmation",
				]);
			}
			runWrangler([
				"d1",
				"migrations",
				"apply",
				getDatabaseName(env),
				...getEnvFlags(env),
				...getRemoteFlags(env),
			]);
		}),
);

program.addCommand(
	new Command("backup")
		.description("Export a local or remote D1 database to a SQL file.")
		.addOption(
			new Option("-e, --env <environment>", "Target environment.")
				.choices(allowedEnvironments)
				.default("local"),
		)
		.option("-o, --output <file>", "Destination .sql file path. Defaults to .wrangler/backups/<db>-<env>-<timestamp>.sql.")
		.option("-a, --archive-dir <path>", "Directory where the backup file is stored.")
		.addHelpText(
			"after",
			`
Examples:
  db backup --env local
  db backup --env local --output ./tmp/local-backup.sql
  db backup --env preview
  db backup --env production
`,
		)
		.action((options: { env: DbEnvironment; output?: string; archiveDir?: string }) => {
			const env = options.env;
			const archiveDir = resolveArchiveDir(options.archiveDir);
			const output = options.output
				? joinArchivePath(archiveDir, options.output)
				: resolveOutputPath(env, archiveDir);
			runWrangler([
				"d1",
				"export",
				getDatabaseName(env),
				...getEnvFlags(env),
				...getRemoteFlags(env),
				"--output",
				output,
				"--skip-confirmation",
			]);
		}),
);

program.addCommand(
	new Command("restore")
		.description("Restore a local or remote database from an exported SQL backup.")
		.addOption(
			new Option("-e, --env <environment>", "Target environment.")
				.choices(allowedEnvironments)
				.default("local"),
		)
		.option("-f, --file <path>", "Path to the backup file.")
		.option("-a, --archive-dir <path>", "Directory where backup files are stored.")
		.option("--latest", "Use the latest local backup from the archive directory for this environment.")
		.addHelpText(
			"after",
			`
Examples:
  db restore --env local --file local-backup.sql
  db restore --env local --latest
  db restore --env preview --file preview-backup.sql
  db restore --env preview --file preview-backup.sql --archive-dir ./.my-backups
`,
		)
		.action((options: { env: DbEnvironment; file?: string; latest?: boolean; archiveDir?: string }) => {
			const env = options.env;
			const file = options.file;
			const useLatest = Boolean(options.latest);
			const archiveDir = resolveArchiveDir(options.archiveDir);
			if (!file && !useLatest) {
				throw new Error("Either --file or --latest is required.");
			}
			if (file && useLatest) {
				throw new Error("Use either --file or --latest, not both.");
			}

			const sqlFile = file ? joinArchivePath(archiveDir, file) : latestBackupFile(env, archiveDir);
			if (!sqlFile) {
				throw new Error(
					`No backup file found for environment ${env}. Provide --file or create a backup first.`,
				);
			}

			if (env === "local") {
				const backups = resetLocalSqliteDbForRestore(archiveDir);
				if (backups.length > 0) {
					console.log("Local database backup(s) created before restore:");
					for (const backup of backups) {
						console.log(`  - ${backup}`);
					}
				} else {
					console.log("No existing local sqlite file to backup before restore.");
				}
			}

			runWrangler([
				"d1",
				"execute",
				getDatabaseName(env),
				...getEnvFlags(env),
				...getRemoteFlags(env),
				"--file",
				sqlFile,
			]);
		}),
);

program.addCommand(
	new Command("seed")
		.description("Execute a SQL seed file against a D1 environment.")
		.addOption(
			new Option("-e, --env <environment>", "Target environment.")
				.choices(allowedEnvironments)
				.default("local"),
		)
		.option("-f, --file <name>", "Seed file name (relative to --dir). If omitted and only one .sql exists, it is used automatically.")
		.option("-d, --dir <path>", "Directory containing seed files (default: seeds/).", "seeds")
		.addHelpText(
			"after",
			`
Note: Seeds are NOT tracked in d1_migrations and must be idempotent. They
run using "wrangler d1 execute" against the target environment.

Examples:
  db seed --env local
  db seed --env local --file admin-bootstrap.sql
  db seed --env preview --file admin-bootstrap.sql
  db seed --env production --file admin-bootstrap.sql
  db seed --dir ./custom-seeds --file my-seed.sql
`,
		)
		.action((options: { env: DbEnvironment; file?: string; dir: string }) => {
			const env = options.env;
			const seedDir = resolve(process.cwd(), options.dir);

			if (!existsSync(seedDir)) {
				throw new Error(`Seed directory not found: ${seedDir}. Create the directory and add .sql seed files.`);
			}

			const sqlFiles = readdirSync(seedDir)
				.filter((name) => name.endsWith(".sql"))
				.sort();

			if (sqlFiles.length === 0) {
				throw new Error(`No .sql files found in ${seedDir}.`);
			}

			let seedFile: string;
			if (options.file) {
				seedFile = resolve(seedDir, options.file);
				if (!existsSync(seedFile)) {
					throw new Error(`Seed file not found: ${seedFile}`);
				}
			} else if (sqlFiles.length === 1) {
				seedFile = resolve(seedDir, sqlFiles[0]);
				console.log(`Using seed file: ${sqlFiles[0]}`);
			} else {
				console.error("Multiple seed files found. Specify one with --file:");
				for (const file of sqlFiles) {
					console.error(`  ${file}`);
				}
				process.exit(1);
			}

			runWrangler([
				"d1",
				"execute",
				getDatabaseName(env),
				...getEnvFlags(env),
				...getRemoteFlags(env),
				"--file",
				seedFile,
			]);
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
