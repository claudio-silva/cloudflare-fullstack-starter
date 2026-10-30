/**
 * What a deploy has to migrate, and in which order.
 *
 * Migrations run inside the Worker, so the Worker serving traffic can only
 * report — and only apply — the migrations bundled with it. The ones this
 * release adds are unknown to it: asked before the deploy, it answers that
 * nothing is pending. They are read from this checkout instead, and since
 * only the new code can apply them, a release that brings any is deployed in
 * a maintenance window: deploy the new code taken out of service, migrate,
 * deploy it again in service.
 *
 * A migration the running Worker does not know may already be applied (a
 * Worker rolled back past it). Counting it as pending only costs an
 * unneeded window; the migrate step itself skips what is applied.
 */
import type { MigrationCompatibility, MigrationStatus } from "../../src/shared/migration-types";

export type LocalMigration = { compatibility?: MigrationCompatibility; safeSince?: string };

export type PlannedMigration = {
	name: string;
	compatibility: MigrationCompatibility;
	safeSince: string | null;
	/** Bundled with this release only: the running Worker cannot apply it. */
	newInRelease: boolean;
};

export type MigrationPlan = {
	pending: PlannedMigration[];
	byKind: (kind: MigrationCompatibility) => PlannedMigration[];
	/** Why the deploy needs a maintenance window, or null when it does not. */
	windowReason: string | null;
};

export function planMigrations(running: MigrationStatus[], local: Record<string, LocalMigration>): MigrationPlan {
	const known = new Set(running.map((m) => m.name));
	const pending: PlannedMigration[] = [
		...running.filter((m) => !m.applied).map((m) => ({ name: m.name, compatibility: m.compatibility, safeSince: m.safeSince, newInRelease: false })),
		...Object.entries(local)
			.filter(([name]) => !known.has(name))
			.map(([name, m]) => ({ name, compatibility: m.compatibility ?? "expand", safeSince: m.safeSince ?? null, newInRelease: true })),
	].sort((a, b) => a.name.localeCompare(b.name));

	const breaking = pending.filter((m) => m.compatibility === "breaking");
	const added = pending.filter((m) => m.newInRelease && m.compatibility !== "contract");
	const windowReason =
		breaking.length > 0
			? `${breaking.map((m) => m.name).join(", ")} ${breaking.length === 1 ? "is" : "are"} breaking`
			: added.length > 0
				? `${added.map((m) => m.name).join(", ")} ${added.length === 1 ? "comes" : "come"} with this release, so only the new code can apply ${added.length === 1 ? "it" : "them"}`
				: null;

	return { pending, byKind: (kind) => pending.filter((m) => m.compatibility === kind), windowReason };
}
