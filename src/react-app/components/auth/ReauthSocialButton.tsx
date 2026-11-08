import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { authClient } from "@/lib/auth/client";
import { socialProviderName } from "@/lib/auth/reauth-methods";
import { REAUTH_CHANNEL, pageNavigationDeps, startSocialReauth, type SocialReauthState } from "@/lib/auth/social-reauth";
import { t } from "@/lib/i18n";
import { Button } from "../ui/button";
import { GoogleLogo } from "./GoogleSignInButton";

/**
 * "Continue with <Provider>" inside the re-login dialog. Signs in through a popup so the page and the
 * requests held on it stay; when the browser blocks the popup it falls back to a redirect, after the
 * discard confirm (lib/auth/social-reauth.ts). Never a dead end: every way the popup can fail ends
 * with the button usable again and a message.
 */
export function ReauthSocialButton({ provider }: { provider: string }) {
	const [state, setState] = useState<SocialReauthState>("idle");
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const name = socialProviderName(provider);

	const onClick = () => {
		void startSocialReauth(provider, {
			// Synchronously, in this click: see startSocialReauth.
			openWindow: (url, target, features) => window.open(url, target, features),
			signInSocial: (args) => authClient.signIn.social({ ...args, provider }),
			channel: () => new BroadcastChannel(REAUTH_CHANNEL),
			...pageNavigationDeps,
			location: window.location,
			refetchSession: () => authClient.$store.notify("$sessionSignal"),
			onFocus: (listener) => {
				window.addEventListener("focus", listener);
				return () => window.removeEventListener("focus", listener);
			},
			setTimeout: (fn, ms) => window.setTimeout(fn, ms),
			clearTimeout: (handle) => window.clearTimeout(handle as number),
			onState: (next) => mounted.current && setState(next),
		});
	};

	return (
		<div className="space-y-2">
			<Button type="button" variant="outline" className="w-full" onClick={onClick} disabled={state === "busy"}>
				{state === "busy" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : provider === "google" ? <GoogleLogo className="h-5 w-5 mr-2" /> : null}
				{t("session.continueWith", { provider: name })}
			</Button>
			{state === "failed" && (
				<p role="alert" className="text-center text-xs text-destructive">
					{t("session.socialFailed", { provider: name })}
				</p>
			)}
		</div>
	);
}
