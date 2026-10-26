import { useSyncExternalStore } from "react";
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

/**
 * After "Later": a line across the top of the page that stays until the
 * user updates — or until the next navigation, which updates by itself. It
 * sits in the page flow rather than over it, so it never covers anything.
 */
export function UpdateBanner() {
	const { status } = useUpdateState();
	if (status !== "pending") return null;
	return (
		<div role="status" className="flex items-center justify-center gap-3 border-b bg-muted px-4 py-1.5 text-sm">
			<span>{t("update.banner", { app: config.appName })}</span>
			<Button size="sm" variant="outline" className="h-7" onClick={updateNow}>
				{t("update.bannerAction")}
			</Button>
		</div>
	);
}
