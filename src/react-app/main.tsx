import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import "./index.css";
import App from "./App.tsx";
import { ThemeProvider } from "./components/theme-provider";

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<BrowserRouter>
			<ThemeProvider defaultTheme="light" storageKey="app-theme">
				<App />
				<Toaster position="top-center" richColors />
			</ThemeProvider>
		</BrowserRouter>
	</StrictMode>,
);
