import { useEffect, useState } from "react";
import { http } from "@/lib/http";

/**
 * Which sign-in methods this deployment actually offers.
 *
 * Asked of the server rather than read from `src/config.ts`, because the flag
 * alone does not decide it: Google sign-in needs `enableGoogleAuth` **and**
 * the two credentials in the Worker's environment (src/worker/middleware/auth.ts).
 * A button shown on the strength of the flag alone is a button that locks up
 * and does nothing — which reads as a bug in the app, not as a step somebody
 * has yet to take.
 *
 * `GET /api/` is public and cheap, and the answer is asked once per page load.
 */
export type AuthFeatures = { google: boolean };

let request: Promise<AuthFeatures> | null = null;

function loadAuthFeatures(): Promise<AuthFeatures> {
	request ??= http("/api/", { handles: "all" })
		.then(async (res) => (res.ok ? ((await res.json()) as { googleAuth?: boolean }) : {}))
		.then((body) => ({ google: body.googleAuth === true }))
		.catch(() => ({ google: false }));
	return request;
}

/** `undefined` while asking — render nothing until it is known, to avoid a button that blinks in. */
export function useAuthFeatures(): AuthFeatures | undefined {
	const [features, setFeatures] = useState<AuthFeatures | undefined>(undefined);
	useEffect(() => {
		let live = true;
		void loadAuthFeatures().then((value) => live && setFeatures(value));
		return () => {
			live = false;
		};
	}, []);
	return features;
}
