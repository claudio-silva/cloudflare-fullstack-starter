import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_DISABLED_PATH, expelToAccountDisabledPage, withAccountDisabledGuard } from "../src/react-app/lib/auth/account-disabled";
import { isUnloadGuardSuspended, resumeUnloadGuards } from "../src/react-app/lib/auth/held-requests";
import { getSessionEnded } from "../src/react-app/lib/auth/session-ended";
import { accountDisabledBody } from "../src/shared/account-status";

/**
 * A 403 account_disabled under /api/ sends the tab to the public page
 * (src/react-app/lib/auth/account-disabled.ts). What has to hold: the caller
 * never sees the response (no toast flash while navigating), other 403s are
 * untouched, and the page itself never loops.
 */

const ORIGIN = "http://app.test";
const disabled = () => Response.json(accountDisabledBody(), { status: 403 });
const never = (p: Promise<unknown>) => Promise.race([p.then(() => "settled"), new Promise((r) => setTimeout(() => r("pending"), 50))]);

afterEach(() => {
	vi.unstubAllGlobals();
	resumeUnloadGuards();
	getSessionEnded().resume();
});

describe("withAccountDisabledGuard", () => {
	it("a 403 with the body calls onDisabled once and never settles the caller", async () => {
		const onDisabled = vi.fn();
		const f = withAccountDisabledGuard(async () => disabled(), onDisabled, ORIGIN);
		expect(await never(f("/api/profile"))).toBe("pending");
		expect(onDisabled).toHaveBeenCalledTimes(1);
	});

	it("Better Auth's call (absolute same-origin URL) is covered too", async () => {
		const onDisabled = vi.fn();
		const f = withAccountDisabledGuard(async () => disabled(), onDisabled, ORIGIN);
		expect(await never(f(new Request(`${ORIGIN}/api/auth/get-session`)))).toBe("pending");
		expect(onDisabled).toHaveBeenCalledTimes(1);
	});

	it("a 403 without the code is returned", async () => {
		const onDisabled = vi.fn();
		const res = Response.json({ error: "no", code: "forbidden" }, { status: 403 });
		const f = withAccountDisabledGuard(async () => res, onDisabled, ORIGIN);
		expect(await f("/api/x")).toBe(res);
		expect(onDisabled).not.toHaveBeenCalled();
	});

	it("a cross-origin 403 is untouched", async () => {
		const onDisabled = vi.fn();
		const f = withAccountDisabledGuard(async () => disabled(), onDisabled, ORIGIN);
		expect((await f("http://other.test/api/x")).status).toBe(403);
		expect(onDisabled).not.toHaveBeenCalled();
	});

	it("a same-origin path outside /api/ is untouched", async () => {
		const onDisabled = vi.fn();
		const f = withAccountDisabledGuard(async () => disabled(), onDisabled, ORIGIN);
		expect((await f("/other")).status).toBe(403);
		expect(onDisabled).not.toHaveBeenCalled();
	});

	it("a non-JSON 403 is returned", async () => {
		const onDisabled = vi.fn();
		const f = withAccountDisabledGuard(async () => new Response("<html>", { status: 403 }), onDisabled, ORIGIN);
		expect((await f("/api/x")).status).toBe(403);
		expect(onDisabled).not.toHaveBeenCalled();
	});

	it("on /account-disabled the response is returned (no loop)", async () => {
		vi.stubGlobal("location", { pathname: ACCOUNT_DISABLED_PATH, replace: vi.fn() });
		const onDisabled = vi.fn();
		const f = withAccountDisabledGuard(async () => disabled(), onDisabled, ORIGIN);
		expect((await f("/api/auth/sign-out", { method: "POST" })).status).toBe(403);
		expect(onDisabled).not.toHaveBeenCalled();
	});
});

describe("expelToAccountDisabledPage", () => {
	it("stands the unload guards down, freezes the session logic, replaces once; a persisted pageshow brings them back", () => {
		const replace = vi.fn();
		const listeners: ((e: Event) => void)[] = [];
		vi.stubGlobal("location", { pathname: "/profile", replace });
		vi.stubGlobal("addEventListener", (_t: string, l: (e: Event) => void) => void listeners.push(l));
		expelToAccountDisabledPage();
		expelToAccountDisabledPage();
		expect(replace).toHaveBeenCalledTimes(1);
		expect(replace).toHaveBeenCalledWith(ACCOUNT_DISABLED_PATH);
		expect(isUnloadGuardSuspended()).toBe(true);
		expect(getSessionEnded().isLeaving()).toBe(true);
		listeners[0]({ persisted: true } as unknown as Event);
		expect(isUnloadGuardSuspended()).toBe(false);
		expect(getSessionEnded().isLeaving()).toBe(false);
	});
});
