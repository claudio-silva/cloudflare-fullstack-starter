import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import "./index.css";
import App from "./App.tsx";
import { ThemeProvider } from "./components/theme-provider";
import { MaintenanceOverlay } from "./components/MaintenanceOverlay";
import { installMaintenanceInterceptor } from "./lib/maintenance";

// Before anything renders, so a call made during the first paint is covered
// too. It patches global fetch, which is the only way to also catch requests
// issued by libraries such as Better Auth.
installMaintenanceInterceptor();

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<BrowserRouter>
			<ThemeProvider defaultTheme="light" storageKey="app-theme">
				<App />
				<MaintenanceOverlay />
				<Toaster position="top-center" richColors />
			</ThemeProvider>
		</BrowserRouter>
	</StrictMode>,
);
