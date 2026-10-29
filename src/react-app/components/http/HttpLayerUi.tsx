import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { config } from "../../../config";
import { t } from "@/lib/i18n";
import { cancelHeld, retryNow } from "@/lib/http/connectivity";
import { getUi } from "@/lib/http/ui";
import { updateNow } from "@/lib/http/version";
import { Button } from "@/components/ui/button";
import { useBlocked, useConnectivity, useMaintenance, useUpdateState, type Blocked } from "./hooks";

/**
 * Everything the HTTP layer shows, outside the app's own tree.
 *
 * Two kinds of trouble, treated differently:
 *
 *  - **Blocking:** requests are being held — no connection, or a maintenance
 *    window. Letting the user carry on would only pile up more requests that
 *    cannot be answered, in an app that no longer responds to what they do.
 *    So the page is dimmed and made inert: no clicks, no focus, no Tab, until
 *    it is over. Offline with nothing held (everything answered by offline
 *    handlers) is not blocking: the app works.
 *  - **Not blocking:** a new version. The app keeps working, at some risk; a
 *    banner says so.
 *
 * A blocked page is shown in one of two ways (`installHttpLayer({ ui: {
 * blockWith } })`): `"banner"` (default), the banner across the top over a
 * dimmed page; `"dialog"`, a dialog in the middle of it.
 *
 * Blocking uses the `inert` attribute on every other child of `<body>` —
 * the app, but also dialogs and toasts portalled there — which is what the
 * browser itself offers for this: inert content takes no clicks and no focus,
 * and whatever had focus loses it. Focus goes to the banner's main button, so
 * Enter tries again; Tab and Shift+Tab go round the layer's own buttons, and
 * a click on the dimmed page keeps focus where it is. Afterwards, focus
 * returns where it was.
 *
 * The banners are fixed, because app shells such as TopBar are themselves
 * fixed to the viewport and would cover anything in the page flow. Their
 * height is published as `--app-banner-h`, which `body` (index.css), TopBar
 * and the sign-in overlay offset by; a fixed layout of your own should too.
 *
 * Each part can be turned off with `installHttpLayer({ ui })`, to show your
 * own from the hooks in ./hooks.ts — blocking included (`useBlocked`).
 */
export function HttpLayerUi() {
	const [root] = useState(layerRoot);
	const blocked = useBlocked();
	const asDialog = blocked !== null && getUi().blockWith === "dialog";
	useInertOutside(root, blocked !== null);

	const stack = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const element = stack.current;
		if (!element || typeof ResizeObserver === "undefined") return;
		const style = document.documentElement.style;
		const observer = new ResizeObserver(() => {
			const height = element.offsetHeight;
			if (height > 0) style.setProperty("--app-banner-h", `${height}px`);
			else style.removeProperty("--app-banner-h");
		});
		observer.observe(element);
		return () => {
			observer.disconnect();
			style.removeProperty("--app-banner-h");
		};
	}, []);

	return createPortal(
		<>
			{blocked && (
				// Clicking the dimmed page does nothing, and keeps focus where it is (on Try now, for Enter).
				<div aria-hidden className="fixed inset-0 z-[55] bg-black/50" onMouseDown={(event) => event.preventDefault()} />
			)}
			<div ref={stack} className="fixed inset-x-0 top-0 z-[60] flex flex-col">
				{!(asDialog && blocked === "maintenance") && <MaintenanceBanner />}
				{!(asDialog && blocked === "connectivity") && <ConnectivityBanner />}
				<UpdateBanner />
			</div>
			{asDialog && <BlockingDialog reason={blocked} />}
		</>,
		root,
	);
}

/** The layer's own child of `<body>`: the one left alive while the rest is inert. */
function layerRoot(): HTMLElement {
	const existing = document.getElementById("http-layer");
	if (existing) return existing;
	const root = document.createElement("div");
	root.id = "http-layer";
	// A Radix modal sets `pointer-events: none` on <body> while open; the banners
	// must stay clickable even if the connection drops with one open.
	root.style.pointerEvents = "auto";
	document.body.appendChild(root);
	return root;
}

/** While `active`, every child of `<body>` but `keep` is inert — those added meanwhile too. */
function useInertOutside(keep: HTMLElement, active: boolean) {
	useEffect(() => {
		if (!active) return;
		const madeInert: HTMLElement[] = [];
		const block = (node: Node) => {
			if (node === keep || !(node instanceof HTMLElement) || node.inert) return;
			node.inert = true;
			madeInert.push(node);
		};
		const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		for (const child of [...document.body.children]) block(child);
		const observer = new MutationObserver((records) => records.forEach((r) => r.addedNodes.forEach(block)));
		observer.observe(document.body, { childList: true });
		// Tab and Shift+Tab go round the layer's own controls, never out of it.
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Tab") return;
			event.preventDefault();
			const controls = [...keep.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])")];
			if (controls.length === 0) return;
			const at = controls.indexOf(document.activeElement as HTMLElement);
			const next = at === -1 ? 0 : (at + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
			controls[next].focus();
		};
		document.addEventListener("keydown", onKeyDown, true);
		// Into the banner (or dialog), so Enter tries again; otherwise nowhere.
		const target = keep.querySelector<HTMLElement>("[data-autofocus]");
		if (target) target.focus();
		else if (document.activeElement instanceof HTMLElement && !keep.contains(document.activeElement)) document.activeElement.blur();
		return () => {
			observer.disconnect();
			document.removeEventListener("keydown", onKeyDown, true);
			for (const node of madeInert) node.inert = false;
			if (previous?.isConnected && !keep.contains(previous)) previous.focus({ preventScroll: true });
		};
	}, [keep, active]);
}

function Banner({ tone, children }: { tone: string; children: ReactNode }) {
	return (
		<div
			role="status"
			aria-live="polite"
			className={`flex min-h-10 flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-1.5 text-center text-sm text-white ${tone}`}
		>
			{children}
		</div>
	);
}

const MAINTENANCE_TONE = "bg-[hsl(35_45%_28%)]";
const OFFLINE_TONE = "bg-[hsl(0_30%_30%)]";
const UPDATE_TONE = "bg-[hsl(215_32%_27%)]";

/**
 * Informational only: the interceptor in lib/http/maintenance.ts is already
 * holding the requests and will replay them. A "retry" button would invite a
 * second request alongside the one being retried for the user.
 */
function MaintenanceText() {
	const state = useMaintenance();
	return (
		<>
			<span>
				<strong className="font-medium">{t("maintenance.title", { app: config.appName })}</strong> {t("maintenance.body")}
			</span>
			<span className="tabular-nums opacity-80">
				{state.nextAttemptIn > 0 ? t("maintenance.countdown", { seconds: state.nextAttemptIn }) : t("maintenance.checking")}
			</span>
		</>
	);
}

export function MaintenanceBanner() {
	const { active } = useMaintenance();
	if (!active || !getUi().maintenance) return null;
	return (
		<Banner tone={MAINTENANCE_TONE}>
			<MaintenanceText />
		</Banner>
	);
}

/**
 * While the server cannot be reached (lib/http/connectivity.ts). "Try now"
 * skips the countdown; Cancel, shown only while something is held, gives up
 * on what is waiting.
 */
function ConnectivityText({ buttonTone }: { buttonTone: string }) {
	const { state, held, phase, nextAttemptIn } = useConnectivity();
	const status =
		state === "reconnecting"
			? t("connection.reconnecting")
			: phase === "waiting-for-network"
				? t("connection.waitingForNetwork")
				: phase === "waiting" && nextAttemptIn > 0
					? t("connection.countdown", { seconds: nextAttemptIn })
					: t("connection.checking");
	return (
		<>
			<span>
				<strong className="font-medium">{t("connection.title", { app: config.appName })}</strong>
				{held > 0 && <> {t("connection.held")}</>}
			</span>
			<span className="tabular-nums opacity-80">{status}</span>
			{state === "offline" && (
				<span className="flex gap-2">
					{/* Never disabled while checking: it would lose focus, and Enter with it. */}
					<Button data-autofocus size="sm" className={`h-7 bg-white hover:bg-white/90 ${buttonTone}`} onClick={retryNow}>
						{t("connection.retry")}
					</Button>
					{held > 0 && (
						<Button size="sm" variant="ghost" className="h-7 text-white hover:bg-white/15 hover:text-white" onClick={cancelHeld}>
							{t("connection.cancel")}
						</Button>
					)}
				</span>
			)}
		</>
	);
}

export function ConnectivityBanner() {
	const { state } = useConnectivity();
	const { active: maintenance } = useMaintenance();
	// During maintenance, its own banner speaks.
	if ((state !== "offline" && state !== "reconnecting") || maintenance || !getUi().connectivity) return null;
	return (
		<Banner tone={OFFLINE_TONE}>
			<ConnectivityText buttonTone="text-[hsl(0_30%_30%)]" />
		</Banner>
	);
}

/** The `"dialog"` way of blocking: the same content, in the middle of the dimmed page. */
function BlockingDialog({ reason }: { reason: Exclude<Blocked, null> }) {
	const tone = reason === "maintenance" ? MAINTENANCE_TONE : OFFLINE_TONE;
	return (
		<div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
			<div
				role="alertdialog"
				aria-modal="true"
				aria-live="polite"
				className={`flex w-full max-w-md flex-col items-center gap-3 rounded-lg p-6 text-center text-sm text-white shadow-2xl ${tone}`}
			>
				{reason === "maintenance" ? <MaintenanceText /> : <ConnectivityText buttonTone="text-[hsl(0_30%_30%)]" />}
			</div>
		</div>
	);
}

/**
 * After "Postpone" (UpdatePrompt.tsx): a countdown to the automatic update,
 * which in its last minute becomes a request to save what is unsaved.
 */
export function UpdateBanner() {
	const { status, deadline } = useUpdateState();
	const left = useSecondsUntil(status === "pending" ? deadline : null);
	if (status !== "pending" || !getUi().update || left === null) return null;
	const time = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
	return (
		// Dark, desaturated blue with white text: clearly not part of the page.
		<Banner tone={UPDATE_TONE}>
			{/* A timer, not a live region: read on request, not announced every second. */}
			<span role="timer" className="tabular-nums">
				{t("update.banner", { app: config.appName })}{" "}
				{left > 60 ? (
					t("update.bannerCountdown", { time })
				) : (
					<strong className="font-semibold">{t("update.bannerSoon", { seconds: left })}</strong>
				)}
			</span>
			<Button size="sm" className="h-7 bg-white text-[hsl(215_32%_27%)] hover:bg-white/90" onClick={updateNow}>
				{t("update.bannerAction")}
			</Button>
		</Banner>
	);
}

/** Whole seconds left until `deadline` (epoch ms), ticking; `null` without one. */
function useSecondsUntil(deadline: number | null): number | null {
	const [now, setNow] = useState(Date.now);
	useEffect(() => {
		if (deadline === null) return;
		const tick = () => setNow(Date.now());
		// `now` may date from long before the deadline was set: refresh it at once.
		const first = setTimeout(tick, 0);
		const timer = setInterval(tick, 1000);
		return () => {
			clearTimeout(first);
			clearInterval(timer);
		};
	}, [deadline]);
	return deadline === null ? null : Math.max(0, Math.ceil((deadline - now) / 1000));
}
