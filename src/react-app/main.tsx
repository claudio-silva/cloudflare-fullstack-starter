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

// Before anything renders, so a call made during the first paint is covered
// too. It patches global fetch, which is the only way to also catch requests
// issued by libraries such as Better Auth. See lib/http/interceptor.ts.
installHttpLayer({
	// A 401 means the session is gone: have Better Auth re-check it, which
	// brings up the sign-in overlay on protected pages.
	onUnauthorized: () => authClient.$store.notify("$sessionSignal"),
});

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<BrowserRouter>
			<ThemeProvider defaultTheme="light" storageKey="app-theme">
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
