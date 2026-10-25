/**
 * Is deploying from CI switched on?
 *
 * The switch is `mode` in deploy.config.ts: `manual` turns CI deploys off,
 * anything else leaves them on. One committed value, so turning them off and
 * back on is a one-line change with a history, and `deploy:production` on
 * every developer's machine reads the same answer as the CI does.
 *
 * Run it as the FIRST step of a CI deploy job, before installing anything:
 *
 *   node bin/ci-deploy-guard.ts || { [ $? -eq 78 ] && exit 0; exit 1; }
 *
 *   exit 0   deploys are on; carry on
 *   exit 78  deploys are off; the job ends here, green, having done nothing
 *   other    a real error, which must fail the job rather than pass for "off"
 *
 * Plain `node`, no dependencies: Node 24 strips the types from deploy.config.ts
 * by itself. That is the point — with deploys off, a triggered job should cost
 * a container start, not an install and a build.
 *
 * `deploy-pipeline` checks the same thing, for CI that runs it without this.
 */

const OFF = 78; // EX_CONFIG, from sysexits.h

const { deployConfig } = (await import(new URL("../deploy.config.ts", import.meta.url).href)) as {
	deployConfig: { mode: string };
};
// Same precedence as bin/lib/deploy-config.ts: an explicit DEPLOY_MODE wins.
const mode = process.env.DEPLOY_MODE || deployConfig.mode;

if (mode === "manual") {
	console.log('CI deploys are OFF: deploy.config.ts has mode "manual". Nothing was deployed.');
	console.log("Deploy from a machine with deploy:production, or set the mode back to turn CI deploys on.");
	process.exit(OFF);
}
console.log(`CI deploys are on (mode "${mode}").`);
