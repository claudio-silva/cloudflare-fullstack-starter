import { useEffect, useState } from "react";
import { config } from "../../../config";
import { t } from "@/lib/i18n";
import { getMaintenanceState, subscribeToMaintenance, type MaintenanceState } from "@/lib/http/maintenance";

/**
 * Shown while the app is in a maintenance window.
 *
 * It is informational only: the interceptor in `lib/http/maintenance.ts` is
 * already holding the failed requests and will replay them, so there is
 * nothing for the user to do and deliberately nothing to click. Offering a
 * "retry" button would invite a second request alongside the one being
 * retried for them.
 *
 * It is not a modal dialog either — a window can open while the user is mid
 * sentence, and stealing focus to say "wait a moment" is worse than a banner
 * that says the same thing.
 */
export function MaintenanceOverlay() {
	const [state, setState] = useState<MaintenanceState>(getMaintenanceState);

	useEffect(() => subscribeToMaintenance(setState), []);

	if (!state.active) return null;

	return (
		<div role="status" aria-live="polite" className="fixed inset-x-0 top-0 z-[100] flex justify-center p-3">
			<div className="flex max-w-xl items-center gap-3 rounded-lg border bg-background/95 px-4 py-3 shadow-lg backdrop-blur">
				<span className="relative flex h-2.5 w-2.5 shrink-0">
					<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
					<span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
				</span>
				<div className="text-sm">
					<p className="font-medium">{t("maintenance.title", { app: config.appName })}</p>
					<p className="text-muted-foreground">{t("maintenance.body")}</p>
					<p className="text-muted-foreground tabular-nums">
						{state.nextAttemptIn > 0
							? t("maintenance.countdown", { seconds: state.nextAttemptIn })
							: t("maintenance.checking")}
					</p>
				</div>
			</div>
		</div>
	);
}
