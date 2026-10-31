/**
 * The two pure decisions of the site's theme: what counts as a theme, and how
 * one is carried to the app.
 *
 * Plain ESM with no build step, so the same file is what the browser loads
 * (`site.js` imports it) and what the unit tests import
 * (test/scripts/website.test.ts). There is no second copy to drift.
 */

export const THEMES = ["light", "dark", "system"];
export const STORAGE_KEY = "app-theme";

/** A stored or typed value, as a theme; `light` when it is anything else. */
export function resolveTheme(value) {
	return THEMES.includes(value) ? value : "light";
}

/** The theme to actually paint: `system` asks the operating system. */
export function effectiveTheme(theme, prefersDark) {
	return theme === "system" ? (prefersDark ? "dark" : "light") : resolveTheme(theme);
}

/**
 * `href` with `?theme=` set, so the app opens in the theme chosen here and
 * remembers it (src/react-app/components/theme-provider.tsx reads the
 * parameter, stores it and takes it out of the URL).
 *
 * The site and the app are different origins — apex and `app.` subdomain — so
 * they do not share localStorage; the URL is the only way across.
 */
export function withTheme(href, theme, base = "http://localhost") {
	const url = new URL(href, base);
	url.searchParams.set("theme", resolveTheme(theme));
	return url.toString();
}
