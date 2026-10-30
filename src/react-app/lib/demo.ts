import { useEffect, useState } from "react";
import { http } from "@/lib/http";

/**
 * The demo accounts, when the app runs as the public demo (the `DEMO_MODE`
 * secret, src/worker/middleware/demo.ts); `null` everywhere else. Several
 * when the demo shows each role: lowest role first, sharing one password.
 *
 * Asked once per page load: `GET /api/demo` answers 404 outside demo mode,
 * which this treats as the normal answer, not an error.
 */
export type DemoAccount = { email: string; password: string; role: string | null };

let request: Promise<DemoAccount[] | null> | null = null;

function loadDemoAccounts(): Promise<DemoAccount[] | null> {
	request ??= http("/api/demo", { handles: "all" })
		.then(async (res) => (res.ok ? ((await res.json()) as { accounts: DemoAccount[] }).accounts : null))
		.then((accounts) => (accounts && accounts.length > 0 ? accounts : null))
		.catch(() => null);
	return request;
}

/** `undefined` while asking, then the accounts or `null`. */
export function useDemoAccounts(): DemoAccount[] | null | undefined {
	const [accounts, setAccounts] = useState<DemoAccount[] | null | undefined>(undefined);
	useEffect(() => {
		let live = true;
		void loadDemoAccounts().then((value) => live && setAccounts(value));
		return () => {
			live = false;
		};
	}, []);
	return accounts;
}
