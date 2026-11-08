import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { REAUTH_CHANNEL, type ReauthMessage } from "@/lib/auth/social-reauth";
import { t } from "@/lib/i18n";

/**
 * Where the social re-login popup lands (`callbackURL` / `errorCallbackURL`). It tells the window that
 * opened it over a BroadcastChannel, never `window.opener` (the provider's pages sever that), and
 * closes itself. The text stays in case the browser refuses to close a window.
 */
export function ReauthComplete() {
	const [params] = useSearchParams();
	const ok = !params.has("error");
	useEffect(() => {
		const channel = new BroadcastChannel(REAUTH_CHANNEL);
		channel.postMessage({ type: "reauth-complete", ok } satisfies ReauthMessage);
		channel.close();
		window.close();
	}, [ok]);
	return (
		<div className="min-h-screen flex items-center justify-center px-4">
			<p className="text-center text-sm text-muted-foreground">{ok ? t("session.reauthDone") : t("session.socialFailed", { provider: "the provider" })}</p>
		</div>
	);
}
