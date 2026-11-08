import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import "./index.css";
import App from "./App.tsx";
import { ThemeProvider } from "./components/theme-provider";
import { TooltipProvider } from "./components/ui/tooltip";
import { HttpLayerUi } from "./components/http/HttpLayerUi";
import { UpdateDialog } from "./components/http/UpdatePrompt";
import { installHttpLayer } from "./lib/http/interceptor";
import { authClient } from "./lib/auth/client";
import { setHeldRequests } from "./lib/auth/held-requests";
import { getSessionEnded, trackPageLeaving, withSessionEndedGuard } from "./lib/auth/session-ended";

trackPageLeaving(window);

// A request answered 401 changed nothing (authMiddleware refuses before any
// handler), so the guard holds it behind the re-login dialog and replays it.
const sessionEndedGuard = (next: typeof fetch) =>
	withSessionEndedGuard(next, getSessionEnded(), location.origin, { onHeldChange: (_count, summary) => setHeldRequests(summary) });

// Before anything renders, so a call made during the first paint is covered
// too. It patches global fetch, which is the only way to also catch requests
// issued by libraries such as Better Auth. See lib/http/interceptor.ts.
installHttpLayer({
	// A 401 means the session is gone: have Better Auth re-check it, which
	// ends the session under the open page (the re-login dialog) or, with no
	// session known, shows the sign-in page.
	onUnauthorized: () => authClient.$store.notify("$sessionSignal"),
	guards: [sessionEndedGuard],
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
				</TooltipProvider>
			</ThemeProvider>
		</BrowserRouter>
	</StrictMode>,
);
