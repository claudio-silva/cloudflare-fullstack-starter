import fs from "fs";
import path from "path";
import readline from "readline";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type Answers = {
	projectName: string;
	appDomain: string;
	previewDomain: string;
};

const isInteractive = process.stdin.isTTY;

function parseArgs(): Partial<Answers> & { help?: boolean; runMigrations?: boolean } {
	const args = process.argv.slice(2);
	const result: Partial<Answers> & { help?: boolean; runMigrations?: boolean } = {};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--help" || arg === "-h") {
			result.help = true;
		} else if (arg === "--name" && args[i + 1]) {
			result.projectName = args[++i];
		} else if (arg === "--app-domain" && args[i + 1]) {
			result.appDomain = args[++i];
		} else if (arg === "--preview-domain" && args[i + 1]) {
			result.previewDomain = args[++i];
		} else if (arg === "--no-migrate") {
			result.runMigrations = false;
		}
	}
	return result;
}

function printHelp() {
	console.log(`
Usage: bin/init [options]

Options:
  --name <slug>            Project name (used for package.json and D1 database)
  --app-domain <url>       Production app URL (e.g., https://app.myapp.com)
  --preview-domain <url>   Preview app URL (e.g., https://preview.myapp.com)
  --no-migrate             Skip running local migrations
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

function runMigrations(root: string) {
	console.log("\n🔄 Running local migrations...");
	try {
		execSync("npm run db:migrate:local", { cwd: root, stdio: "inherit" });
		console.log("✅ Migrations applied successfully.");
	} catch (error) {
		console.error("⚠️  Migration failed. You can run manually: npm run db:migrate:local", error);
	}
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

	const pkg = readJSON(pkgPath);
	const currentName = pkg.name || "starter";

	// Get values from args or prompt
	const projectName = cliArgs.projectName || (await prompt("Project name (slug, used for package and DB)", currentName));
	const appDomain = cliArgs.appDomain || (await prompt("Production app base URL", "https://app.example.com"));
	const previewDomain = cliArgs.previewDomain || (await prompt("Preview app base URL", "https://preview.example.com"));

	const answers: Answers = { projectName, appDomain, previewDomain };

	console.log("\n📝 Updating project files...");

	// Update package.json name and scripts
	updatePackageJsonScripts(pkgPath, projectName);
	console.log("  ✓ package.json");

	// Update wrangler.toml
	updateWranglerToml(wranglerPath, projectName);
	console.log("  ✓ wrangler.toml");

	// Create/update env files from templates without mutating templates
	updateEnvFiles(root, answers);
	console.log("  ✓ env files");

	// Run migrations unless explicitly disabled
	const shouldMigrate = cliArgs.runMigrations !== false;
	if (shouldMigrate) {
		runMigrations(root);
	}

	console.log("\n✅ Init complete!");
	console.log("\nNext steps:");
	if (!shouldMigrate) {
		console.log("  1. Run migrations: npm run db:migrate:local");
		console.log("  2. Start dev server: npm run dev");
	} else {
		console.log("  1. Start dev server: npm run dev");
	}
	console.log("\nOptional:");
	console.log("  • Set RESEND_API_KEY in .env.local for email verification");
	console.log("  • Create a user: npm run auth create-user -u admin@example.com -p password");
}

main().catch((err) => {
	console.error("Init failed:", err);
	process.exit(1);
});
