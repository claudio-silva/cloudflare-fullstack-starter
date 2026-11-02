import type { FocusEvent } from "react";

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

// `countryName()` is used by the profile page too, so it lives in its own file.
export { countryName } from "./country";
