/**
 * Which version `deploy-production` releases. Pure, so it can be tested.
 *
 * `pkgVersion` is the release field of package.json: `version`, or
 * `starter.version` with `APP_VERSION_FROM=starter` (see build-info.ts).
 */

export type BumpKind = "patch" | "minor" | "major";

function semver(version: string): [number, number, number] | null {
	const m = version.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
	return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function isAhead(a: [number, number, number], b: [number, number, number]): boolean {
	for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
	return false;
}

/**
 * The next release. Normally the latest tag, bumped. But when `package.json`
 * is ahead of every tag, someone chose that version by hand — or the project
 * is new and still on the 0.0.1 it was created with — so it ships unbumped.
 */
export function nextVersion(latest: string, pkgVersion: string, kind: BumpKind): string {
	const pkg = semver(pkgVersion);
	if (!latest) {
		if (!pkg) throw new Error(`package.json version ${pkgVersion || "<unset>"} is not X.Y.Z`);
		return `v${pkgVersion}`;
	}
	const parsed = semver(latest);
	if (!parsed) throw new Error(`cannot bump non-semver tag ${latest}`);
	if (pkg && isAhead(pkg, parsed)) return `v${pkgVersion}`;
	const [ma, mi, pa] = parsed;
	if (kind === "major") return `v${ma + 1}.0.0`;
	if (kind === "minor") return `v${ma}.${mi + 1}.0`;
	return `v${ma}.${mi}.${pa + 1}`;
}
