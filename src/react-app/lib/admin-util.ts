import type { FocusEvent } from "react";
import { getLocale } from "./i18n";

/**
 * Browser helpers used only by the admin area (src/react-app/admin). They live
 * outside it because they are general, but `npm run admin:remove` deletes this
 * file with the area: add here, rather than in a new file under lib/, anything
 * else only the area needs. Something the rest of the app comes to use moves out
 * to a file of its own.
 */

let pressed = false;

/**
 * Props for a control that should take focus from the keyboard (Tab,
 * Shift+Tab, arrows) but not from a click, such as a tab: clicked, it does its
 * job and leaves no focus ring behind. Preventing the mousedown would be the
 * usual way, but Radix selects a tab on mousedown and skips a prevented one, so
 * the focus is let in and dropped at once, before anything is painted. The
 * browser still starts the next Tab from the clicked control.
 */
export const noFocusOnClick = {
	onPointerDown: () => {
		pressed = true;
		setTimeout(() => (pressed = false));
	},
	onFocus: (event: FocusEvent<HTMLElement>) => {
		if (pressed) event.currentTarget.blur();
	},
};

const displayNames = new Map<string, Intl.DisplayNames>();

/**
 * The name of a country from its ISO 3166-1 code ("PT" → "Portugal"), in the
 * app's language (`getLocale()` in `i18n.ts`). The browser's own data does the
 * translating, so a new language needs nothing here. Anything it does not
 * know comes back as the code.
 */
export function countryName(code: string | null | undefined): string {
	if (!code) return "—";
	const locale = getLocale();
	try {
		let names = displayNames.get(locale);
		if (!names) {
			names = new Intl.DisplayNames([locale], { type: "region" });
			displayNames.set(locale, names);
		}
		return names.of(code.toUpperCase()) ?? code;
	} catch {
		return code;
	}
}
