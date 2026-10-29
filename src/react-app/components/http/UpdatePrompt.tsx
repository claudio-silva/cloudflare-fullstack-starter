import { config } from "../../../config";
import { t } from "@/lib/i18n";
import { postponeUpdate, updateNow } from "@/lib/http/version";
import { getUi } from "@/lib/http/ui";
import {
	AlertDialog,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useUpdateState } from "./hooks";

/**
 * Asked once, the first time the server reports a different version
 * (lib/http/version.ts). After "Postpone", `UpdateBanner` (HttpBanners.tsx) takes over.
 */
export function UpdateDialog() {
	const { status } = useUpdateState();
	return (
		<AlertDialog open={status === "available" && getUi().update}>
			<AlertDialogContent onEscapeKeyDown={(event) => {
				// Escape means "not now", never "never".
				event.preventDefault();
				postponeUpdate();
			}}>
				<AlertDialogHeader>
					<AlertDialogTitle>{t("update.title", { app: config.appName })}</AlertDialogTitle>
					<AlertDialogDescription asChild>
						<div className="space-y-3">
							<p>{t("update.body")}</p>
							<p className="text-xs">
								{t("update.unsaved", { later: t("update.later") })}
								<br />
								{t("update.postponed")}
							</p>
						</div>
					</AlertDialogDescription>
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
