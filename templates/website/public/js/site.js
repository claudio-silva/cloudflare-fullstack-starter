/**
 * The site's only script: the theme control, and carrying the theme to the app.
 *
 * The theme itself is applied before the first paint by the inline script in
 * the <head> — this module only reacts to clicks. Everything the page shows
 * works without it, including the "Open app" links: the Worker has already put
 * the app's URL in them, and the theme is all this adds.
 */
import { STORAGE_KEY, effectiveTheme, resolveTheme, withTheme } from "./app-link.js";

const root = document.documentElement;
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
const themeButtons = document.querySelectorAll("[data-theme-choice]");
const appLinks = document.querySelectorAll("a[data-app-link]");

function stored() {
	try {
		return resolveTheme(localStorage.getItem(STORAGE_KEY));
	} catch {
		return "system";
	}
}

function apply(theme) {
	root.classList.toggle("dark", effectiveTheme(theme, darkQuery.matches) === "dark");
	root.dataset.theme = theme;
	for (const button of themeButtons) {
		button.setAttribute("aria-pressed", String(button.dataset.themeChoice === theme));
	}
	// Kept in the href rather than added on click, so that opening the link in
	// a new tab, or copying it, carries the theme too.
	for (const link of appLinks) link.href = withTheme(link.href, theme);
}

function choose(theme) {
	try {
		localStorage.setItem(STORAGE_KEY, theme);
	} catch {
		// Private browsing, storage off: the choice lasts for this page only.
	}
	apply(theme);
}

for (const button of themeButtons) {
	button.addEventListener("click", () => choose(resolveTheme(button.dataset.themeChoice)));
}

// `system` follows the operating system while it is the choice.
darkQuery.addEventListener("change", () => {
	if (stored() === "system") apply("system");
});

apply(stored());
