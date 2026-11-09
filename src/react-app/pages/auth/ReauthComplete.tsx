import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { REAUTH_ACCOUNT_DISABLED_ERROR, REAUTH_CHANNEL, type ReauthMessage } from "@/lib/auth/social-reauth";
import { t } from "@/lib/i18n";

/**
 * Where the social re-login popup lands (`callbackURL` / `errorCallbackURL`). It tells the window that
 * opened it over a BroadcastChannel, never `window.opener` (the provider's pages sever that), and
 * closes itself. The text stays in case the browser refuses to close a window.
 */
export function ReauthComplete() {
	const [params] = useSearchParams();
	const ok = !params.has("error");
	// The server's disabled-account refusal (worker/lib/sign-in-guard.ts); getAll because Better Auth appends its own `error`.
	const disabled = params.getAll("error").includes(REAUTH_ACCOUNT_DISABLED_ERROR);
	useEffect(() => {
		const channel = new BroadcastChannel(REAUTH_CHANNEL);
		channel.postMessage({ type: "reauth-complete", ok, ...(disabled ? { reason: REAUTH_ACCOUNT_DISABLED_ERROR } : {}) } satisfies ReauthMessage);
		channel.close();
		window.close();
	}, [ok, disabled]);
	return (
		<div className="min-h-screen flex items-center justify-center px-4">
			<p className="text-center text-sm text-muted-foreground">{ok ? t("session.reauthDone") : t("session.reauthFailed")}</p>
		</div>
	);
}
