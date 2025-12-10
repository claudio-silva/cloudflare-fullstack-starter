import { createContext, useContext, useEffect, useState } from "react";

type Theme = "dark" | "light" | "system";

type ThemeProviderProps = {
	children: React.ReactNode;
	defaultTheme?: Theme;
	storageKey?: string;
};

type ThemeProviderState = {
	theme: Theme;
	setTheme: (theme: Theme) => void;
};

const initialState: ThemeProviderState = {
	theme: "system",
	setTheme: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

export function ThemeProvider({
	children,
	defaultTheme = "light",
	storageKey = "app-theme",
}: ThemeProviderProps) {
	// Check for theme in URL parameter (for cross-app navigation)
	const getInitialTheme = (): Theme => {
		// Check URL parameters first
		const urlParams = new URLSearchParams(window.location.search);
		const themeParam = urlParams.get("theme") as Theme | null;
		if (themeParam && ["light", "dark", "system"].includes(themeParam)) {
			// Save to localStorage and remove from URL
			localStorage.setItem(storageKey, themeParam);
			// Clean up URL without page reload
			const newUrl = new URL(window.location.href);
			newUrl.searchParams.delete("theme");
			window.history.replaceState({}, "", newUrl);
			return themeParam;
		}
		// Fall back to localStorage or default
		return (localStorage.getItem(storageKey) as Theme) || defaultTheme;
	};

	const [theme, setTheme] = useState<Theme>(getInitialTheme);

	useEffect(() => {
		const root = window.document.documentElement;

		// Disable all CSS transitions temporarily to prevent flash during theme change
		const disableTransitions = () => {
			const style = document.createElement("style");
			style.id = "theme-transition-disable";
			style.textContent = `
				*, *::before, *::after {
					transition: none !important;
					animation: none !important;
				}
			`;
			document.head.appendChild(style);
			return style;
		};

		// Re-enable transitions after theme change is complete
		const enableTransitions = (style: HTMLStyleElement) => {
			// Use double requestAnimationFrame to ensure theme change is complete
			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					if (document.head.contains(style)) {
						document.head.removeChild(style);
					}
				});
			});
		};

		const transitionStyle = disableTransitions();

		// Force a reflow to ensure styles are applied
		void root.offsetHeight;

		// Apply theme changes
		root.classList.remove("light", "dark");

		// Clear inline background color set by index.html anti-FOUC script
		root.style.backgroundColor = "";

		if (theme === "system") {
			const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
			root.classList.add(systemTheme);
		} else {
			root.classList.add(theme);
		}

		// Re-enable transitions after theme change
		enableTransitions(transitionStyle);
	}, [theme]);

	const value = {
		theme,
		setTheme: (theme: Theme) => {
			localStorage.setItem(storageKey, theme);
			setTheme(theme);
		},
	};

	return <ThemeProviderContext.Provider value={value}>{children}</ThemeProviderContext.Provider>;
}

export const useTheme = () => {
	const context = useContext(ThemeProviderContext);

	if (context === undefined) throw new Error("useTheme must be used within a ThemeProvider");

	return context;
};
