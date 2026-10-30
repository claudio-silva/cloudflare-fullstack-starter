#!/usr/bin/env tsx
/**
 * Remove the example admin area (/admin) from this project. See docs/ADMIN.md.
 *
 *   1. Deletes its own files: the pages, the API, its schemas, its test, its
 *      doc, its helpers (src/react-app/lib/admin-util.ts) and this script.
 *   2. Strips what it added to shared files, which are marked:
 *        - a block between a line containing `[admin-area]` and one
 *          containing `[/admin-area]`, both included;
 *        - a single line containing `[admin-area-line]`;
 *        - the `admin:remove` script in package.json and the admin/ lines
 *          of the file trees in AGENTS.md and README.md, which cannot hold a
 *          marker.
 *
 * Roles, `requireRole()` and the role in the session stay, for whatever you
 * build instead. Everything is checked before anything is changed, so it either
 * applies completely or not at all. Commit first: the result is a working-tree
 * change that `git diff` shows and `git checkout .` undoes.
 *
 * Usage: npm run admin:remove [-- --yes] [--dry-run]
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const SELF = "bin/remove-admin.ts";

/** Files and folders that are only the admin area. */
const OWN_PATHS = [
	"src/react-app/admin",
	"src/worker/routes/admin",
	"src/shared/admin-users.ts",
	"src/react-app/lib/admin-util.ts",
	"test/admin.test.ts",
	"docs/ADMIN.md",
	SELF,
];

const BEGIN = "[admin-area]";
const END = "[/admin-area]";
const LINE = "[admin-area-line]";

/** Lines that cannot carry a marker (JSON, code blocks), by file. */
const UNMARKED_LINES: Record<string, RegExp[]> = {
	"package.json": [/^\s*"admin:remove":\s*"[^"]*",?\s*$/],
	"AGENTS.md": [/^[│├└─\s]*admin\/\s+# Example admin area/],
	"README.md": [/^[│├└─\s]*admin\/\s+# Example admin area/],
};

/** Left behind after removing, these would point at something gone. */
const LEFTOVER = /routes\/admin|@\/admin\/|shared\/admin-users|lib\/admin-util|ADMIN\.md|admin:remove|admin-area/;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const yes = args.includes("--yes") || args.includes("-y");

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

function listFiles(): string[] {
	const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" });
	return out
		.split("\0")
		.filter(Boolean)
		.filter((f) => !OWN_PATHS.some((p) => f === p || f.startsWith(`${p}/`)))
		.filter((f) => existsSync(join(root, f)));
}

type Edit = { file: string; before: string; after: string; removed: number };

/** Returns the file without its admin lines, or throws if its markers do not pair up. */
function strip(file: string, text: string): Edit | null {
	const patterns = UNMARKED_LINES[file] ?? [];
	if (!text.includes("admin-area") && !patterns.some((p) => text.split("\n").some((l) => p.test(l)))) return null;

	const lines = text.split("\n");
	const kept: string[] = [];
	let openedAt = -1;
	let removed = 0;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (openedAt >= 0) {
			if (line.includes(BEGIN)) throw new Error(`${file}:${i + 1}: ${BEGIN} inside the block opened at line ${openedAt + 1}`);
			removed++;
			if (line.includes(END)) {
				openedAt = -1;
				// A block between two blank lines leaves one, not two.
				if (kept.at(-1)?.trim() === "" && lines[i + 1]?.trim() === "") i++;
			}
			continue;
		}
		if (line.includes(END)) throw new Error(`${file}:${i + 1}: ${END} without ${BEGIN}`);
		if (line.includes(BEGIN)) {
			openedAt = i;
			removed++;
		} else if (line.includes(LINE) || patterns.some((p) => p.test(line))) {
			removed++;
		} else {
			kept.push(line);
		}
	}
	if (openedAt >= 0) throw new Error(`${file}:${openedAt + 1}: ${BEGIN} is never closed`);
	if (removed === 0) return null;
	return { file, before: text, after: kept.join("\n"), removed };
}

async function confirm(question: string): Promise<boolean> {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	const answer = await new Promise<string>((resolve) => rl.question(question, resolve));
	rl.close();
	return /^y(es)?$/i.test(answer.trim());
}

async function main() {
	const own = OWN_PATHS.filter((p) => existsSync(join(root, p)));
	const edits: Edit[] = [];
	for (const file of listFiles()) {
		if (file === SELF) continue;
		const text = readFileSync(join(root, file), "utf8");
		if (text.includes("\0")) continue; // binary
		const edit = strip(file, text);
		if (edit) edits.push(edit);
	}

	if (own.length === 0 && edits.length === 0) {
		console.log("The admin area is not in this project: nothing to remove.");
		return;
	}

	console.log("Removing the example admin area:\n");
	for (const p of own) console.log(`  delete  ${p}`);
	for (const e of edits) console.log(`  edit    ${e.file} (${e.removed} line${e.removed === 1 ? "" : "s"})`);
	console.log("\nRoles, requireRole() and the role in the session stay.");

	if (dryRun) {
		console.log("\n--dry-run: nothing changed.");
		return;
	}
	if (!yes) {
		if (!process.stdin.isTTY) {
			console.error("\nNot a terminal: pass --yes to remove without asking.");
			process.exit(1);
		}
		const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim();
		if (dirty) console.log("\nThe working tree has uncommitted changes: commit them first to be able to undo this.");
		if (!(await confirm("\nRemove it? [y/N] "))) {
			console.log("Nothing changed.");
			return;
		}
	}

	for (const e of edits) writeFileSync(join(root, e.file), e.after);
	for (const p of own) rmSync(join(root, p), { recursive: true, force: true });

	const leftovers = listFiles().flatMap((file) => {
		const text = readFileSync(join(root, file), "utf8");
		if (text.includes("\0")) return [];
		return text
			.split("\n")
			.map((line, i) => (LEFTOVER.test(line) ? `  ${file}:${i + 1}: ${line.trim()}` : null))
			.filter((l): l is string => l !== null);
	});

	console.log("\nDone.");
	if (leftovers.length) {
		console.log("\nThese lines still mention it; check them:\n");
		console.log(leftovers.join("\n"));
	}
	console.log("\nNext: npm run type-check, npm run lint and npm test.");
	console.log("To undo before committing: git checkout -- . (from the project root).");
}

main().catch((error: unknown) => {
	console.error(`\nNothing changed: ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
});
