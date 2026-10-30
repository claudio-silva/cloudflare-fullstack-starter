import type { FocusEvent } from "react";

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
