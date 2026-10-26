import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import "./index.css";
import App from "./App.tsx";
import { ThemeProvider } from "./components/theme-provider";
import { MaintenanceOverlay } from "./components/http/MaintenanceOverlay";
import { ConnectionDialog } from "./components/http/ConnectionDialog";
import { UpdateBanner, UpdateDialog } from "./components/http/UpdatePrompt";
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
				<UpdateBanner />
				<App />
				<MaintenanceOverlay />
				<ConnectionDialog />
				<UpdateDialog />
				<Toaster position="top-center" richColors />
			</ThemeProvider>
		</BrowserRouter>
	</StrictMode>,
);
