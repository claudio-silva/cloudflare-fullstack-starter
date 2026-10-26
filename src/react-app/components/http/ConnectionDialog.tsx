import { useSyncExternalStore } from "react";
import { config } from "../../../config";
import { t } from "@/lib/i18n";
import { cancelHeldRequests, connectionStore, retryConnectionNow } from "@/lib/http/connection";
import {
	AlertDialog,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

/**
 * The one dialog for a lost connection, however many requests are held behind
 * it (lib/http/connection.ts). Modal, unlike the maintenance banner: what the
 * user was doing has not happened yet, and they may want to give up on it.
 */
export function ConnectionDialog() {
	const state = useSyncExternalStore(connectionStore.subscribe, connectionStore.get);
	const restored = state.phase === "restored";

	return (
		<AlertDialog open={state.open}>
			<AlertDialogContent onEscapeKeyDown={(event) => event.preventDefault()}>
				<AlertDialogHeader>
					<AlertDialogTitle>{t("connection.title", { app: config.appName })}</AlertDialogTitle>
					<AlertDialogDescription>{restored ? t("connection.restored") : t("connection.body")}</AlertDialogDescription>
				</AlertDialogHeader>
				{!restored && (
					<p className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
						{state.phase === "waiting" && state.nextAttemptIn > 0
							? t("connection.countdown", { seconds: state.nextAttemptIn })
							: t("connection.checking")}
					</p>
				)}
				<AlertDialogFooter>
					<Button variant="outline" onClick={cancelHeldRequests}>
						{t("connection.cancel")}
					</Button>
					<Button onClick={retryConnectionNow} disabled={state.phase === "checking"}>
						{restored ? t("connection.send") : t("connection.retry")}
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
