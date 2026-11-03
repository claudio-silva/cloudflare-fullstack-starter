import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { detachAdvice, inheritedTags, isStarterRemote, remoteIdentity } from "../../bin/lib/project-git";

const REPO = resolve(import.meta.dirname, "..", "..");
const STARTER = { repo: "https://github.com/claudio-silva/fullstack-starter-for-cloudflare", version: "3.7.0" };

describe("is this still the starter's repository?", () => {
	it("recognises the same remote however it was written", () => {
		for (const url of [
			"https://github.com/claudio-silva/fullstack-starter-for-cloudflare",
			"https://github.com/claudio-silva/fullstack-starter-for-cloudflare.git",
			"git@github.com:claudio-silva/fullstack-starter-for-cloudflare.git",
			"ssh://git@github.com/claudio-silva/fullstack-starter-for-cloudflare/",
			"https://token@github.com/Claudio-Silva/Fullstack-Starter-For-Cloudflare",
		]) {
			expect(isStarterRemote(url, STARTER.repo)).toBe(true);
		}
	});

	it("leaves the project's own remote alone", () => {
		expect(isStarterRemote("git@github.com:me/my-app.git", STARTER.repo)).toBe(false);
		expect(isStarterRemote("https://gitlab.com/claudio-silva/fullstack-starter-for-cloudflare", STARTER.repo)).toBe(false);
		expect(isStarterRemote("", STARTER.repo)).toBe(false);
		expect(remoteIdentity("git@github.com:me/app.git")).toBe("github.com/me/app");
	});
});

describe("the tags a clone inherits", () => {
	const tags = ["v1.0.0", "v3.0.0", "v3.7.0"];

	it("are the starter's when the project numbers itself differently", () => {
		expect(inheritedTags(tags, STARTER, "0.0.1")).toEqual(tags);
	});

	it("are nothing in the starter's own repository", () => {
		// There, package.json's version *is* the starter's version.
		expect(inheritedTags(tags, STARTER, "3.7.0")).toEqual([]);
	});

	it("are nothing when the starter's own version is not among them", () => {
		expect(inheritedTags(["v1.0.0", "v1.1.0"], STARTER, "1.1.0")).toEqual([]);
		expect(inheritedTags([], STARTER, "0.0.1")).toEqual([]);
	});

	it("never include a tag the project made after the starter's", () => {
		expect(inheritedTags([...tags, "v4.0.0", "v3.7.1"], STARTER, "0.0.1")).toEqual(tags);
	});

	it("say what to do about them", () => {
		const advice = detachAdvice({ origin: "https://github.com/claudio-silva/fullstack-starter-for-cloudflare", tags }).join("\n");
		expect(advice).toContain("git remote set-url origin");
		expect(advice).toContain("git tag -d");
	});
});

// --- init, on a clone of the template -------------------------------------

function clonedProject(): string {
	const root = mkdtempSync(join(tmpdir(), "init-git-"));
	// `bin/` included: init edits the project its own file lives in, which in a
	// real clone is this one. (Running the starter's own copy from elsewhere is
	// refused, and that is the point.)
	for (const path of ["package.json", "wrangler.toml", "src/config.ts", "env", ".env.example", "bin", "deploy.config.ts"]) {
		cpSync(join(REPO, path), join(root, path), { recursive: true });
	}
	// Shared rather than installed: the scripts are what is being tested.
	symlinkSync(join(REPO, "node_modules"), join(root, "node_modules"));
	const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
	git("init", "-q");
	git("config", "user.email", "test@example.com");
	git("config", "user.name", "Test");
	git("remote", "add", "origin", `${STARTER.repo}.git`);
	writeFileSync(join(root, "seed.txt"), "x");
	git("add", "-A");
	git("commit", "-qm", "clone");
	// What a `git clone` of the template brings with it.
	for (const tag of ["v1.0.0", "v3.7.0"]) git("tag", tag);
	return root;
}

const run = (root: string, args: string[]) =>
	execFileSync(join(REPO, "node_modules", ".bin", "tsx"), [join(root, "bin", "init.ts"), ...args], { cwd: root, encoding: "utf-8" });

const gitOut = (root: string, args: string[]) => {
	try {
		return execFileSync("git", args, { cwd: root, encoding: "utf-8" }).trim();
	} catch {
		return "";
	}
};

const ARGS = ["--name", "my-app", "--app-name", "My App", "--app-domain", "https://app.acme.io", "--preview-domain", "https://preview.acme.io"];

describe("npm run init, in a repository cloned from the starter", () => {
	it("refuses to initialise a project the caller is not standing in", () => {
		const root = clonedProject();
		// What turned this very test into an accident once: the starter's own
		// init, run from somewhere else, edits the starter.
		let output = "";
		try {
			execFileSync(join(REPO, "node_modules", ".bin", "tsx"), [join(REPO, "bin", "init.ts"), ...ARGS], { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
		} catch (error) {
			const e = error as { stdout?: string; stderr?: string };
			output = `${e.stdout ?? ""}${e.stderr ?? ""}`;
		}
		expect(output).toContain("run it from the project root");
		expect(readFileSync(join(root, "package.json"), "utf-8")).toContain('"cloudflare-fullstack-starter"');
		rmSync(root, { recursive: true, force: true });
	});

	it("forgets the starter's remote and its release tags", () => {
		const root = clonedProject();
		const output = run(root, ARGS);

		expect(output).toContain("removed the starter's");
		expect(gitOut(root, ["remote"])).toBe("");
		expect(gitOut(root, ["tag", "--list"])).toBe("");
		// The project's own history is untouched.
		expect(gitOut(root, ["log", "--oneline"])).toContain("clone");
		rmSync(root, { recursive: true, force: true });
	});

	it("keeps them with --keep-git, and says what they will do", () => {
		const root = clonedProject();
		const output = run(root, [...ARGS, "--keep-git"]);

		expect(output).toContain("--keep-git");
		expect(output).toContain("git remote set-url origin");
		expect(gitOut(root, ["remote", "get-url", "origin"])).toContain("fullstack-starter-for-cloudflare");
		expect(gitOut(root, ["tag", "--list"]).split("\n")).toEqual(["v1.0.0", "v3.7.0"]);
		rmSync(root, { recursive: true, force: true });
	});

	it("has nothing to do in a repository that is already the project's own", () => {
		const root = clonedProject();
		execFileSync("git", ["remote", "set-url", "origin", "git@github.com:me/my-app.git"], { cwd: root, stdio: "ignore" });
		execFileSync("git", ["tag", "-d", "v1.0.0", "v3.7.0"], { cwd: root, stdio: "ignore" });

		expect(run(root, ARGS)).not.toContain("removed the starter's");
		expect(gitOut(root, ["remote", "get-url", "origin"])).toBe("git@github.com:me/my-app.git");
		rmSync(root, { recursive: true, force: true });
	});
});

describe("deploy:production, with the starter's git still attached", () => {
	it("refuses rather than pushing a release to the starter", () => {
		const root = clonedProject();
		// init is what normally cuts the ties; this is the net under it.
		const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8")) as Record<string, unknown>;
		writeFileSync(join(root, "package.json"), JSON.stringify({ ...pkg, name: "my-app", version: "0.0.1" }, null, 2));

		let output = "";
		try {
			execFileSync(join(REPO, "node_modules", ".bin", "tsx"), [join(root, "bin", "deploy-production.ts"), "--yes"], { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
		} catch (error) {
			const e = error as { stdout?: string; stderr?: string };
			output = `${e.stdout ?? ""}${e.stderr ?? ""}`;
		}
		expect(output).toContain("still the starter's");
		expect(output).toContain("git remote set-url origin");
		expect(output).toContain("git tag -d");
		rmSync(root, { recursive: true, force: true });
	});
});
