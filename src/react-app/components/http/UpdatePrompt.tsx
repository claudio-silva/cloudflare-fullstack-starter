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
 * (lib/http/version.ts). After "Postpone", `UpdateBanner` (HttpLayerUi.tsx) takes over.
 *
 * When the server no longer accepts this version (`required`), the same dialog
 * without "Postpone": every request would be refused, so there is nothing to
 * go back to. Being modal, it blocks the page like the HTTP layer's own blocking.
 */
export function UpdateDialog() {
	const { status } = useUpdateState();
	const required = status === "required";
	return (
		<AlertDialog open={(status === "available" || required) && getUi().update}>
			<AlertDialogContent onEscapeKeyDown={(event) => {
				// Escape means "not now", never "never" — and nothing at all when updating is required.
				event.preventDefault();
				if (!required) postponeUpdate();
			}}>
				{required ? (
					<AlertDialogHeader>
						<AlertDialogTitle>{t("update.requiredTitle", { app: config.appName })}</AlertDialogTitle>
						<AlertDialogDescription>{t("update.requiredBody")}</AlertDialogDescription>
					</AlertDialogHeader>
				) : (
					<AlertDialogHeader>
						<AlertDialogTitle>{t("update.title", { app: config.appName })}</AlertDialogTitle>
						<AlertDialogDescription asChild>
							<div className="space-y-3">
								<p>{t("update.body")}</p>
								<p className="text-xs">
									{t("update.unsaved", { later: t("update.later") })}
									<br />
									{t("update.postponed", { app: config.appName, minutes: config.http.updateGraceMinutes })}
								</p>
							</div>
						</AlertDialogDescription>
					</AlertDialogHeader>
				)}
				<AlertDialogFooter>
					{!required && (
						<Button variant="outline" onClick={() => postponeUpdate()}>
							{t("update.later")}
						</Button>
					)}
					<Button onClick={updateNow}>{t("update.now")}</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
