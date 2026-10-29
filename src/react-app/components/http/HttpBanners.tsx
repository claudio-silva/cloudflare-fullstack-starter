import { useEffect, useRef } from "react";
import { config } from "../../../config";
import { t } from "@/lib/i18n";
import { cancelHeld, retryNow } from "@/lib/http/connectivity";
import { getUi } from "@/lib/http/ui";
import { updateNow } from "@/lib/http/version";
import { Button } from "@/components/ui/button";
import { useConnectivity, useMaintenance, useUpdateState } from "./hooks";

/**
 * The HTTP layer's banners, stacked across the top of the page: maintenance,
 * lost connection, and a postponed update.
 *
 * Banners, not dialogs: none of these needs an answer, and a dialog would
 * take the page away from someone in the middle of reading or typing. What
 * they were doing is held and carries on by itself.
 *
 * The stack is fixed, because app shells such as TopBar are themselves fixed
 * to the viewport and would cover anything in the page flow. It publishes its
 * height as `--app-banner-h`, which `body` (index.css) and TopBar offset by;
 * a fixed layout of your own should do the same.
 *
 * Each banner can be turned off with `installHttpLayer({ ui })`, to show your
 * own from the hooks in ./hooks.ts.
 */
export function HttpBanners() {
	const stack = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const element = stack.current;
		if (!element || typeof ResizeObserver === "undefined") return;
		const root = document.documentElement.style;
		const observer = new ResizeObserver(() => {
			const height = element.offsetHeight;
			if (height > 0) root.setProperty("--app-banner-h", `${height}px`);
			else root.removeProperty("--app-banner-h");
		});
		observer.observe(element);
		return () => {
			observer.disconnect();
			root.removeProperty("--app-banner-h");
		};
	}, []);

	return (
		// Above app shells and the sign-in overlay (z-50), which start below it.
		<div ref={stack} className="fixed inset-x-0 top-0 z-[60] flex flex-col">
			<MaintenanceBanner />
			<ConnectivityBanner />
			<UpdateBanner />
		</div>
	);
}

function Banner({ tone, children }: { tone: string; children: React.ReactNode }) {
	return (
		<div
			role="status"
			aria-live="polite"
			className={`flex min-h-10 flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-1.5 text-center text-sm text-white ${tone}`}
		>
			{children}
		</div>
	);
}

const bannerButton = "h-7 bg-white hover:bg-white/90";

/**
 * Informational only: the interceptor in lib/http/maintenance.ts is already
 * holding the requests and will replay them. A "retry" button would invite a
 * second request alongside the one being retried for the user.
 */
export function MaintenanceBanner() {
	const state = useMaintenance();
	if (!state.active || !getUi().maintenance) return null;
	return (
		<Banner tone="bg-[hsl(35_45%_28%)]">
			<span>
				<strong className="font-medium">{t("maintenance.title", { app: config.appName })}</strong> {t("maintenance.body")}
			</span>
			<span className="tabular-nums opacity-80">
				{state.nextAttemptIn > 0 ? t("maintenance.countdown", { seconds: state.nextAttemptIn }) : t("maintenance.checking")}
			</span>
		</Banner>
	);
}

/**
 * While the server cannot be reached (lib/http/connectivity.ts). "Try now"
 * skips the countdown; Cancel, shown only while something is held, gives up
 * on what is waiting. Maintenance speaks for itself, so this one steps aside.
 */
export function ConnectivityBanner() {
	const { state, held, phase, nextAttemptIn } = useConnectivity();
	if ((state !== "offline" && state !== "reconnecting") || !getUi().connectivity) return null;

	const status =
		state === "reconnecting"
			? t("connection.reconnecting")
			: phase === "waiting-for-network"
				? t("connection.waitingForNetwork")
				: phase === "waiting" && nextAttemptIn > 0
					? t("connection.countdown", { seconds: nextAttemptIn })
					: t("connection.checking");

	return (
		<Banner tone="bg-[hsl(0_30%_30%)]">
			<span>
				<strong className="font-medium">{t("connection.title", { app: config.appName })}</strong>
				{held > 0 && <> {t("connection.held")}</>}
			</span>
			<span className="tabular-nums opacity-80">{status}</span>
			{state === "offline" && (
				<span className="flex gap-2">
					<Button size="sm" className={`${bannerButton} text-[hsl(0_30%_30%)]`} onClick={retryNow}>
						{t("connection.retry")}
					</Button>
					{held > 0 && (
						<Button size="sm" variant="ghost" className="h-7 text-white hover:bg-white/15 hover:text-white" onClick={cancelHeld}>
							{t("connection.cancel")}
						</Button>
					)}
				</span>
			)}
		</Banner>
	);
}

/**
 * After "Postpone" (lib/http/version.ts): stays until the user updates — or
 * until the next navigation, which updates by itself.
 */
export function UpdateBanner() {
	const { status } = useUpdateState();
	if (status !== "pending" || !getUi().update) return null;
	return (
		// Dark, desaturated blue with white text: clearly not part of the page.
		<Banner tone="bg-[hsl(215_32%_27%)]">
			<span>{t("update.banner", { app: config.appName })}</span>
			<Button size="sm" className={`${bannerButton} text-[hsl(215_32%_27%)]`} onClick={updateNow}>
				{t("update.bannerAction")}
			</Button>
		</Banner>
	);
}
