import { createContext, useContext } from "react";

export type Theme = "dark" | "light" | "system";

export type ThemeProviderState = {
	theme: Theme;
	setTheme: (theme: Theme) => void;
};

export const ThemeContext = createContext<ThemeProviderState | undefined>(undefined);

export const useTheme = () => {
	const context = useContext(ThemeContext);

	if (context === undefined) {
		throw new Error("useTheme must be used within a ThemeProvider");
	}

	return context;
};
