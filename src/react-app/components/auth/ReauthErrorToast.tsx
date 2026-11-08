import { useEffect } from "react";
import { toast } from "sonner";
import { t } from "@/lib/i18n";
import { socialProviderName } from "@/lib/auth/reauth-methods";
import { takeReauthError } from "@/lib/auth/social-reauth";

/**
 * Back from the social re-login redirect the provider refused: the browser did a cold load, where
 * an ended session shows the plain sign-in page, not the dialog. So the error is read once at boot
 * (only with our `reauth_error` marker), shown as a toast and stripped from the URL. Mount it next
 * to the `<Toaster />`, after it.
 */
export function ReauthErrorToast() {
	useEffect(() => {
		const { failed, provider, cleanHref } = takeReauthError(window.location.href);
		if (!failed) return;
		window.history.replaceState(window.history.state, "", cleanHref);
		toast.error(t("session.socialFailed", { provider: socialProviderName(provider ?? "") }));
	}, []);
	return null;
}
