#!/usr/bin/env tsx
/**
 * Run the product website's dev server, on its own (`dev:website`) or beside
 * the app's (`dev:all`). `npm run dev` is untouched and still starts the app
 * alone: most work does not involve the website, and a second server that
 * nobody asked for is a second thing to go wrong.
 *
 * The point of this runner is the app's URL. The website's "Open app" button
 * must point at the dev server that is actually running, whose port is not
 * fixed — `bin/worktree-dev` picks a free one per worktree. So the port is
 * decided HERE, once, and passed both ways: `--port <p> --strictPort` to Vite,
 * and `--var APP_URL:http://localhost:<p>` to the website's Worker. Nothing is
 * scraped from any output.
 *
 * The port itself, in order: `--app-port`, else the one in APP_BASE_URL in
 * `.env.local` (what worktree-dev writes, and what the auth CLI and the E2E
 * tests already read), else 5173.
 *
 * Usage: tsx bin/dev-all.ts [--website-only] [--app-port <n>] [--website-port <n>]
 */
import { spawn, type ChildProcess } from "node:child_process";
import { connect, createServer } from "node:net";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { requireWebsiteConfig } from "./lib/website-config";

const packageManager = (process.env.npm_config_user_agent ?? "npm").split("/")[0];

function flag(args: string[], name: string): string | undefined {
	const i = args.indexOf(name);
	return i === -1 ? undefined : args[i + 1];
}

/** The port the app's dev server runs on; see the note above for the order. */
export function appPortFrom(envLocal: string | null, override?: string): number {
	const asked = Number(override);
	if (Number.isInteger(asked) && asked > 0) return asked;
	const url = envLocal ? /^APP_BASE_URL=["']?(https?:\/\/[^\s"']+)/m.exec(envLocal)?.[1] : undefined;
	const port = url ? Number(new URL(url).port) : NaN;
	return Number.isInteger(port) && port > 0 ? port : 5173;
}

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/**
 * Is something listening on `port`? Asked of both loopback addresses: Vite
 * binds `localhost`, which on macOS is ::1, so an IPv4-only probe waits for
 * ever on a server that is already up.
 */
function listening(port: number): Promise<boolean> {
	const onHost = (host: string) =>
		new Promise<boolean>((done) => {
			const socket = connect({ port, host });
			const settle = (answer: boolean) => {
				socket.destroy();
				done(answer);
			};
			socket.setTimeout(1_000);
			socket.on("connect", () => settle(true));
			socket.on("error", () => settle(false));
			socket.on("timeout", () => settle(false));
		});
	return Promise.all([onHost("127.0.0.1"), onHost("::1")]).then((answers) => answers.includes(true));
}

/**
 * Wait until the app's dev server is up before starting the website's.
 *
 * Not politeness: both run a Workers runtime, and two of them coming up in the
 * same instant fight over a socket workerd picks for itself — the website then
 * dies with "Address already in use (socket \"direct:1:default\")" while the app
 * is fine. Started a moment apart, they coexist happily.
 */
async function waitForApp(port: number, timeoutMs = 90_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await listening(port)) return;
		await sleep(300);
	}
	console.log(`  (the app is not listening on ${port} yet; starting the website anyway)`);
}

function freePort(): Promise<number> {
	return new Promise((done, fail) => {
		const server = createServer();
		server.on("error", fail);
		server.listen(0, "127.0.0.1", () => {
			const port = (server.address() as { port: number }).port;
			server.close(() => done(port));
		});
	});
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const websiteOnly = args.includes("--website-only");
	const root = process.cwd();
	const website = requireWebsiteConfig(root);

	const envLocal = existsSync(resolve(root, ".env.local")) ? readFileSync(resolve(root, ".env.local"), "utf-8") : null;
	const appPort = appPortFrom(envLocal, flag(args, "--app-port"));
	const websitePort = Number(flag(args, "--website-port")) || (await freePort());
	const appUrl = `http://localhost:${appPort}`;

	const children: ChildProcess[] = [];
	const start = (command: string, commandArgs: string[]) => {
		console.log(`  $ ${command} ${commandArgs.join(" ")}`);
		const child = spawn(command, commandArgs, { stdio: "inherit", env: process.env });
		child.on("exit", (code) => {
			// One server down means a half-working pair; stop the other too, so
			// the terminal does not look fine while nothing works.
			for (const other of children) if (other !== child) other.kill("SIGTERM");
			process.exit(code ?? 0);
		});
		children.push(child);
	};

	console.log(websiteOnly ? "Website dev server:" : "App and website dev servers:");
	if (!websiteOnly) {
		start(packageManager, ["run", "dev", "--", "--port", String(appPort), "--strictPort"]);
		await waitForApp(appPort);
	}
	start("npx", ["wrangler", "dev", "--config", `${website.dir}/wrangler.toml`, "--port", String(websitePort), "--var", `APP_URL:${appUrl}`]);

	console.log(`\n  website  http://localhost:${websitePort}`);
	console.log(`  app      ${appUrl}${websiteOnly ? "  (not started: --website-only)" : ""}`);
	console.log(`  "Open app" on the website points at ${appUrl}\n`);

	for (const signal of ["SIGINT", "SIGTERM"] as const) {
		process.on(signal, () => {
			for (const child of children) child.kill(signal);
		});
	}
}

// Imported by the tests for `appPortFrom`; only a direct run starts servers.
if (process.argv[1]?.endsWith("dev-all.ts")) {
	main().catch((error: unknown) => {
		console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	});
}
