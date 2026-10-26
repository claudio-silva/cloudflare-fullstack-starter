import { useEffect, useState } from "react";
import { http } from "@/lib/http";

/**
 * The demo account, when the app runs as the public demo (the `DEMO_MODE`
 * secret, src/worker/middleware/demo.ts); `null` everywhere else.
 *
 * Asked once per page load: `GET /api/demo` answers 404 outside demo mode,
 * which this treats as the normal answer, not an error.
 */
export type DemoAccount = { email: string; password: string };

let request: Promise<DemoAccount | null> | null = null;

function loadDemoAccount(): Promise<DemoAccount | null> {
	request ??= http("/api/demo", { handles: "all" })
		.then((res) => (res.ok ? (res.json() as Promise<DemoAccount>) : null))
		.catch(() => null);
	return request;
}

/** `undefined` while asking, then the account or `null`. */
export function useDemoAccount(): DemoAccount | null | undefined {
	const [account, setAccount] = useState<DemoAccount | null | undefined>(undefined);
	useEffect(() => {
		let live = true;
		void loadDemoAccount().then((value) => live && setAccount(value));
		return () => {
			live = false;
		};
	}, []);
	return account;
}
