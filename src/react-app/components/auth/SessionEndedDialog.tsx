import { AlertDialog as AlertDialogPrimitive } from "radix-ui";
import { authClient } from "@/lib/auth/client";
import { getSessionEnded } from "@/lib/auth/session-ended";
import { useAuthFeatures } from "@/lib/auth-features";
import { type ReauthChoice, offeredSocialProviders, readStoredMethods, registeredReauthIds, registeredReauthMethod, resolveReauthMethods } from "@/lib/auth/reauth-methods";
import { t } from "@/lib/i18n";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { AlertDialog, AlertDialogDescription, AlertDialogOverlay, AlertDialogPortal, AlertDialogTitle } from "../ui/alert-dialog";
import { useState, type ReactNode } from "react";
import { Button } from "../ui/button";
import { LoginForm } from "./LoginForm";
import { switchAccount } from "./leave-session";
import { ReauthSocialButton } from "./ReauthSocialButton";

function storedMethods() {
	try {
		return readStoredMethods(window.localStorage);
	} catch {
		return null;
	}
}

/**
 * A session ended under an open page: the sign-in over the kept, dimmed page.
 * Not dismissible: sign in again, or "Use another account". The account is shown as
 * text and it is offered what it signs in with (lib/auth/reauth-methods.ts): the password
 * field, a social popup, an app-registered method. Never a password for an account without one. It calls no navigation after a successful
 * sign-in: Better Auth's session refetch restores the session and this unmounts.
 */
export function SessionEndedDialog() {
	const [leaving, setLeaving] = useState(false);
	const email = getSessionEnded().rememberedEmail() ?? "";
	const features = useAuthFeatures();

	const onSwitchAccount = () =>
		switchAccount({
			// Removes the remembered email (the auth fetch sees the sign-out leave) and the cookie.
			signOut: () => authClient.signOut(),
			navigate: () => window.location.replace("/"),
			onLeaving: () => setLeaving(true),
		});

	const choice = features
		? resolveReauthMethods(storedMethods(), email, offeredSocialProviders(features), registeredReauthIds())
		: undefined;
	// With a password field the exit is a quiet link beside it; without one it is the only exit, so a real button.
	const footer = choice?.password ? (
		<button
			type="button"
			onClick={() => void onSwitchAccount()}
			disabled={leaving}
			className="whitespace-nowrap text-primary hover:underline bg-transparent border-none p-0 cursor-pointer disabled:opacity-50"
		>
			{t("session.useAnotherAccount")}
		</button>
	) : (
		<Button type="button" variant="outline" className="w-full" onClick={() => void onSwitchAccount()} disabled={leaving}>
			{t("session.useAnotherAccount")}
		</Button>
	);

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
							{choice === undefined ? null : (
								<ReauthBody email={email} choice={choice} footer={footer} />
							)}
						</CardContent>
					</Card>
				</AlertDialogPrimitive.Content>
			</AlertDialogPortal>
		</AlertDialog>
	);
}

/** The methods the account has. The password form carries the email and the footer itself; without it they are shown here. */
function ReauthBody({ email, choice, footer }: { email: string; choice: ReauthChoice; footer: ReactNode }) {
	const others = (
		<div className="space-y-3">
			{choice.social.map((id) => (
				<ReauthSocialButton key={id} provider={id} />
			))}
			{choice.registered.map((id) => {
				const Method = registeredReauthMethod(id)?.Component;
				return Method ? <Method key={id} email={email} /> : null;
			})}
		</div>
	);
	if (choice.password) {
		return (
			<LoginForm
				lockedEmail={email}
				lockedFooter={footer}
				lockedExtra={
					choice.social.length + choice.registered.length > 0 ? (
						<>
							<div className="relative my-4">
								<div className="absolute inset-0 flex items-center">
									<span className="w-full border-t" />
								</div>
							</div>
							{others}
						</>
					) : null
				}
			/>
		);
	}
	const none = choice.social.length + choice.registered.length === 0;
	return (
		<div className="space-y-4">
			<p className="text-center text-sm font-medium break-all" data-testid="locked-email">
				{email}
			</p>
			{none ? <p className="text-center text-sm text-muted-foreground" data-testid="no-method">{t("session.noMethod")}</p> : others}
			<div className="text-sm">{footer}</div>
		</div>
	);
}
