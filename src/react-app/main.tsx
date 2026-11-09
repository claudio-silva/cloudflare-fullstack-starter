import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import "./index.css";
import App from "./App.tsx";
import { ThemeProvider } from "./components/theme-provider";
import { TooltipProvider } from "./components/ui/tooltip";
import { HttpLayerUi } from "./components/http/HttpLayerUi";
import { SessionReplacedToast } from "./components/auth/SessionReplacedToast";
import { ReauthErrorToast } from "./components/auth/ReauthErrorToast";
import { UpdateDialog } from "./components/http/UpdatePrompt";
import { installHttpLayer } from "./lib/http/interceptor";
import { authClient } from "./lib/auth/client";
import { setHeldRequests } from "./lib/auth/held-requests";
import { withAccountDisabledGuard, expelToAccountDisabledPage } from "./lib/auth/account-disabled";
import { getSessionEnded, trackPageLeaving, withSessionEndedGuard } from "./lib/auth/session-ended";

trackPageLeaving(window);

// A request answered 401 changed nothing (authMiddleware refuses before any
// handler), so the guard holds it behind the re-login dialog and replays it.
const sessionEndedGuard = (next: typeof fetch) =>
	withSessionEndedGuard(next, getSessionEnded(), location.origin, { onHeldChange: (_count, summary) => setHeldRequests(summary) });

// Any 403 account_disabled under /api/ (Better Auth's included) leaves the tab
// for the public page. Inside the session-ended guard: a disabled account is
// never shown the expired-session dialog.
const accountDisabledGuard = (next: typeof fetch) => withAccountDisabledGuard(next, expelToAccountDisabledPage, location.origin);

// Before anything renders, so a call made during the first paint is covered
// too. It patches global fetch, which is the only way to also catch requests
// issued by libraries such as Better Auth. See lib/http/interceptor.ts.
installHttpLayer({
	// A 401 means the session is gone: have Better Auth re-check it, which
	// ends the session under the open page (the re-login dialog) or, with no
	// session known, shows the sign-in page.
	onUnauthorized: () => authClient.$store.notify("$sessionSignal"),
	guards: [sessionEndedGuard, accountDisabledGuard],
});

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<BrowserRouter>
			<ThemeProvider defaultTheme="system" storageKey="app-theme">
				{/* shadcn's Tooltip needs one provider above it. */}
				<TooltipProvider>
					<HttpLayerUi />
					<App />
					<UpdateDialog />
					<Toaster position="top-center" richColors />
					<SessionReplacedToast />
					<ReauthErrorToast />
				</TooltipProvider>
			</ThemeProvider>
		</BrowserRouter>
	</StrictMode>,
);
