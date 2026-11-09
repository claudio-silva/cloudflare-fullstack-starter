import { useState } from "react";
import { Ban } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Logo } from "@/components/Logo";
import { AuthBackdrop } from "@/components/auth/AuthBackdrop";
import { authClient } from "@/lib/auth/client";
import { t } from "@/lib/i18n";

/** Public page for an account that was disabled. A navigation, not a dialog: the old page's state is dropped on purpose. */
export function AccountDisabled() {
	const [leaving, setLeaving] = useState(false);

	const backToSignIn = async () => {
		setLeaving(true);
		try {
			// Clears the dead session cookie; otherwise "/" would bounce straight back here.
			await authClient.signOut();
		} catch {
			// Nothing to do: we leave anyway.
		}
		window.location.replace("/");
	};

	return (
		<div className="min-h-screen flex flex-col items-center justify-center py-4 px-4">
			<AuthBackdrop />
			<Card className="w-full max-w-md shadow-2xl">
				<CardHeader className="space-y-6">
					<div className="flex justify-center">
						<Logo className="h-12 w-auto" />
					</div>
					<CardTitle className="text-center">{t("accountDisabled.title")}</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<Alert>
						<Ban className="h-5 w-5 -translate-x-1 -translate-y-1" />
						<AlertDescription>{t("accountDisabled.body")}</AlertDescription>
					</Alert>
					<div className="flex justify-center">
						<Button className="w-1/2" disabled={leaving} onClick={() => void backToSignIn()}>
							{t("accountDisabled.back")}
						</Button>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
