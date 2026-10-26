import { useEffect, useSyncExternalStore } from "react";
import { config } from "../../../config";
import { t } from "@/lib/i18n";
import { postponeUpdate, updateNow, updateStore } from "@/lib/http/version";
import {
	AlertDialog,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

const useUpdateState = () => useSyncExternalStore(updateStore.subscribe, updateStore.get);

/** Asked once, the first time the server reports a different version (lib/http/version.ts). */
export function UpdateDialog() {
	const { status } = useUpdateState();
	return (
		<AlertDialog open={status === "available"}>
			<AlertDialogContent onEscapeKeyDown={(event) => {
				// Escape means "not now", never "never".
				event.preventDefault();
				postponeUpdate();
			}}>
				<AlertDialogHeader>
					<AlertDialogTitle>{t("update.title", { app: config.appName })}</AlertDialogTitle>
					<AlertDialogDescription>{t("update.body")}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<Button variant="outline" onClick={postponeUpdate}>
						{t("update.later")}
					</Button>
					<Button onClick={updateNow}>{t("update.now")}</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

/** Height of the banner, published as `--app-banner-h` while it is shown. */
const BANNER_HEIGHT = "2.5rem";

/**
 * After "Later": a line across the top of the page that stays until the
 * user updates — or until the next navigation, which updates by itself.
 *
 * It is fixed, because app shells such as TopBar are themselves fixed to the
 * viewport and would cover anything in the page flow; it pushes them down
 * instead of covering them by setting `--app-banner-h`, which `body` (index.css)
 * and TopBar offset by. A fixed layout of your own should do the same.
 */
export function UpdateBanner() {
	const { status } = useUpdateState();
	const shown = status === "pending";
	useEffect(() => {
		if (!shown) return;
		const root = document.documentElement.style;
		root.setProperty("--app-banner-h", BANNER_HEIGHT);
		return () => {
			root.removeProperty("--app-banner-h");
		};
	}, [shown]);
	if (!shown) return null;
	return (
		<div
			role="status"
			style={{ height: BANNER_HEIGHT }}
			className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-3 border-b bg-muted px-4 text-sm"
		>
			<span>{t("update.banner", { app: config.appName })}</span>
			<Button size="sm" variant="outline" className="h-7" onClick={updateNow}>
				{t("update.bannerAction")}
			</Button>
		</div>
	);
}
