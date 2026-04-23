import fs from "fs";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type Answers = {
	projectName: string;
	appName: string;
	appDomain: string;
	previewDomain: string;
};

const isInteractive = process.stdin.isTTY;

function parseArgs(): Partial<Answers> & { help?: boolean } {
	const args = process.argv.slice(2);
	const result: Partial<Answers> & { help?: boolean } = {};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--help" || arg === "-h") {
			result.help = true;
		} else if (arg === "--name" && args[i + 1]) {
			result.projectName = args[++i];
		} else if (arg === "--app-name" && args[i + 1]) {
			result.appName = args[++i];
		} else if (arg === "--app-domain" && args[i + 1]) {
			result.appDomain = args[++i];
		} else if (arg === "--preview-domain" && args[i + 1]) {
			result.previewDomain = args[++i];
		}
	}
	return result;
}

function printHelp() {
	console.log(`
Usage: bin/init [options]

Options:
  --name <slug>            Project name (used for package.json and D1 database)
  --app-name <name>        App display name (UI, emails, titles)
  --app-domain <url>       Production app URL (e.g., https://app.myapp.com)
  --preview-domain <url>   Preview app URL (e.g., https://preview.myapp.com)
  -h, --help               Show this help

Interactive mode:
  Run without arguments to be prompted for each value.

Non-interactive (for CI/agents):
  Provide all required values via flags:
    bin/init --name myapp --app-domain https://app.myapp.com --preview-domain https://preview.myapp.com
`);
}

async function prompt(question: string, defaultValue: string): Promise<string> {
	if (!isInteractive) {
		return defaultValue;
	}
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	return new Promise((resolve) => {
		rl.question(`${question} [${defaultValue}]: `, (answer) => {
			rl.close();
			resolve(answer.trim() || defaultValue);
		});
	});
}

function readJSON(filePath: string) {
	return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJSON(filePath: string, data: unknown) {
	fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function updateWranglerToml(filePath: string, projectName: string) {
	let content = fs.readFileSync(filePath, "utf8");
	// Update worker name
	content = content.replace(/^name\s*=\s*".*"/m, `name = "${projectName}"`);
	// Update all database_name entries
	content = content.replace(/database_name\s*=\s*"starter-preview"/g, `database_name = "${projectName}-preview"`);
	content = content.replace(/database_name\s*=\s*"starter"/g, `database_name = "${projectName}"`);
	fs.writeFileSync(filePath, content, "utf8");
}

function updateEnvFiles(root: string, answers: Answers) {
	const replaceMap: Record<string, string> = {
		"https://app.example.com": answers.appDomain,
		"https://preview.example.com": answers.previewDomain,
	};

	const envPairs: Array<{ template: string; target: string }> = [
		{ template: path.join(root, ".env.example"), target: path.join(root, ".env.local") },
		{ template: path.join(root, "env", "local.env.template"), target: path.join(root, ".env.local") },
		{ template: path.join(root, "env", "preview.env.template"), target: path.join(root, ".env.preview") },
		{ template: path.join(root, "env", "production.env.template"), target: path.join(root, ".env.production") },
	];

	envPairs.forEach(({ template, target }) => {
		if (!fs.existsSync(template)) return;
		const sourceContent = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : fs.readFileSync(template, "utf8");

		let content = sourceContent;
		Object.entries(replaceMap).forEach(([from, to]) => {
			content = content.replace(new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), to);
		});

		if (!fs.existsSync(target)) {
			fs.copyFileSync(template, target);
		}
		fs.writeFileSync(target, content, "utf8");
	});
}

function readConfigAppName(configPath: string) {
	const content = fs.readFileSync(configPath, "utf8");
	const match = content.match(/appName:\s*"([^"]+)"/);
	return match?.[1] ?? "My App";
}

function updateConfigAppName(configPath: string, appName: string) {
	const content = fs.readFileSync(configPath, "utf8");
	const updated = content.replace(/appName:\s*"[^"]*"/, `appName: "${appName}"`);

	if (updated === content) {
		throw new Error(`Could not update appName in ${configPath}`);
	}

	fs.writeFileSync(configPath, updated, "utf8");
}

function updatePackageJsonScripts(pkgPath: string, projectName: string) {
	const pkg = readJSON(pkgPath);
	// Update migration scripts to use new project name
	const scripts = pkg.scripts || {};
	for (const key of Object.keys(scripts)) {
		if (typeof scripts[key] === "string") {
			scripts[key] = scripts[key].replace(/\bstarter\b/g, projectName);
		}
	}
	pkg.scripts = scripts;
	pkg.name = projectName;
	writeJSON(pkgPath, pkg);
}

async function main() {
	const cliArgs = parseArgs();

	if (cliArgs.help) {
		printHelp();
		process.exit(0);
	}

	const root = path.resolve(__dirname, "..");
	const pkgPath = path.join(root, "package.json");
	const wranglerPath = path.join(root, "wrangler.toml");
	const configPath = path.join(root, "src", "config.ts");

	const pkg = readJSON(pkgPath);
	const currentName = pkg.name || "starter";
	const currentAppName = readConfigAppName(configPath);

	// Get values from args or prompt
	const projectName = cliArgs.projectName || (await prompt("Project name (slug, used for package and DB)", currentName));
	const appName = cliArgs.appName || (await prompt("App display name (UI titles, emails)", currentAppName));
	const appDomain = cliArgs.appDomain || (await prompt("Production app base URL", "https://app.example.com"));
	const previewDomain = cliArgs.previewDomain || (await prompt("Preview app base URL", "https://preview.example.com"));

	const answers: Answers = { projectName, appName, appDomain, previewDomain };

	console.log("\n📝 Updating project files...");

	// Update package.json name and scripts
	updatePackageJsonScripts(pkgPath, projectName);
	console.log("  ✓ package.json");

	// Update wrangler.toml
	updateWranglerToml(wranglerPath, projectName);
	console.log("  ✓ wrangler.toml");

	// Update shared config (UI + emails)
	updateConfigAppName(configPath, appName);
	console.log("  ✓ src/config.ts");

	// Create/update env files from templates without mutating templates
	updateEnvFiles(root, answers);
	console.log("  ✓ env files");

	console.log("\n✅ Init complete!");
	console.log("\nNext steps:");
	console.log("  1. Run migrations: npm run db:migrate:local");
	console.log("  2. Set CLI_API_KEY in .env.local (and in each .env.<env> for remote envs)");
	console.log("  3. Start dev server: npm run dev");
	console.log("\nOptional:");
	console.log("  • Set RESEND_API_KEY in .env.local for email verification");
	console.log("  • Create a user: npm run auth create-user -u admin@example.com -p password");
	console.log("  • Seed data: add .sql files to seeds/ and run: npm run db:seed -- --env local --file <name>.sql");
}

main().catch((err) => {
	console.error("Init failed:", err);
	process.exit(1);
});
