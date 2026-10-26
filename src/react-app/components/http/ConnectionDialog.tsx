import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { config } from "../../../config";
import { t } from "@/lib/i18n";
import { cancelHeldRequests, connectionStore, retryConnectionNow } from "@/lib/http/connection";
import { getMaintenanceState, subscribeToMaintenance } from "@/lib/http/maintenance";
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
 *
 * There is nothing to confirm when the connection returns: the held requests
 * are simply sent, and the dialog closes. "Try now" is focused, so Enter
 * tries at once. During maintenance the maintenance banner speaks instead.
 */
export function ConnectionDialog() {
	const state = useSyncExternalStore(connectionStore.subscribe, connectionStore.get);
	const [maintenance, setMaintenance] = useState(getMaintenanceState);
	useEffect(() => subscribeToMaintenance(setMaintenance), []);
	const tryNow = useRef<HTMLButtonElement>(null);

	return (
		<AlertDialog open={state.open && !maintenance.active}>
			<AlertDialogContent
				onEscapeKeyDown={(event) => event.preventDefault()}
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					tryNow.current?.focus();
				}}
			>
				<AlertDialogHeader>
					<AlertDialogTitle>{t("connection.title", { app: config.appName })}</AlertDialogTitle>
					<AlertDialogDescription>{t("connection.body")}</AlertDialogDescription>
				</AlertDialogHeader>
				<p className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
					{state.phase === "waiting" && state.nextAttemptIn > 0
						? t("connection.countdown", { seconds: state.nextAttemptIn })
						: t("connection.checking")}
				</p>
				<AlertDialogFooter>
					<Button variant="outline" onClick={cancelHeldRequests}>
						{t("connection.cancel")}
					</Button>
					{/* Never disabled while checking: it would lose focus, and Enter with it. */}
					<Button ref={tryNow} onClick={retryConnectionNow}>
						{t("connection.retry")}
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
