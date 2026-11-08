import { AlertDialog as AlertDialogPrimitive } from "radix-ui";
import { authClient } from "@/lib/auth/client";
import { getSessionEnded } from "@/lib/auth/session-ended";
import { t } from "@/lib/i18n";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { AlertDialog, AlertDialogDescription, AlertDialogOverlay, AlertDialogPortal, AlertDialogTitle } from "../ui/alert-dialog";
import { useState } from "react";
import { LoginForm } from "./LoginForm";
import { switchAccount } from "./leave-session";

/**
 * A session ended under an open page: the sign-in over the kept, dimmed page.
 * Not dismissible: sign in again, or "Use another account". The account is shown as
 * text and only the password is asked. It calls no navigation after a successful
 * sign-in: Better Auth's session refetch restores the session and this unmounts.
 */
export function SessionEndedDialog() {
	const [leaving, setLeaving] = useState(false);
	const email = getSessionEnded().rememberedEmail() ?? "";

	const onSwitchAccount = () =>
		switchAccount({
			// Removes the remembered email (the auth fetch sees the sign-out leave) and the cookie.
			signOut: () => authClient.signOut(),
			navigate: () => window.location.replace("/"),
			onLeaving: () => setLeaving(true),
		});

	return (
		<AlertDialog open>
			<AlertDialogPortal>
				<AlertDialogOverlay className="bg-black/50" />
				<AlertDialogPrimitive.Content
					className="fixed top-1/2 left-1/2 z-50 w-full max-w-[22.5rem] -translate-x-1/2 -translate-y-1/2 px-4 focus:outline-none"
					onEscapeKeyDown={(e) => e.preventDefault()}
				>
					<AlertDialogTitle className="sr-only">{t("session.endedTitle")}</AlertDialogTitle>
					<AlertDialogDescription className="sr-only">{t("session.endedBody")}</AlertDialogDescription>
					<Card className="relative w-full shadow-2xl">
						<CardHeader className="space-y-1 px-5 pb-3 pt-5">
							<CardTitle className="text-center text-base">{t("session.endedTitle")}</CardTitle>
							<CardDescription className="text-center text-xs">{t("session.endedBody")}</CardDescription>
						</CardHeader>
						<CardContent className="px-5 pb-6">
							<LoginForm
								lockedEmail={email}
								lockedFooter={
									<button
										type="button"
										onClick={() => void onSwitchAccount()}
										disabled={leaving}
										className="whitespace-nowrap text-primary hover:underline bg-transparent border-none p-0 cursor-pointer disabled:opacity-50"
									>
										{t("session.useAnotherAccount")}
									</button>
								}
							/>
						</CardContent>
					</Card>
				</AlertDialogPrimitive.Content>
			</AlertDialogPortal>
		</AlertDialog>
	);
}
