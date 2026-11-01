/** Geometry of one tab inside its scroller, in the scroller's content coordinates. */
export type TabBox = {
	value: string;
	left: number;
	width: number;
};

export type TabScrollState = {
	/** Tabs not fully inside the viewport right now — the dropdown's contents. */
	hidden: string[];
	canScrollLeft: boolean;
	canScrollRight: boolean;
};

/** A tab this close to an edge is treated as fully visible (anti-aliasing slack). */
const EDGE_SLACK_PX = 2;

export function tabScrollState(
	tabs: readonly TabBox[],
	scrollLeft: number,
	clientWidth: number,
	scrollWidth: number,
): TabScrollState {
	const viewStart = scrollLeft - EDGE_SLACK_PX;
	const viewEnd = scrollLeft + clientWidth + EDGE_SLACK_PX;
	return {
		hidden: tabs
			.filter((t) => t.left < viewStart || t.left + t.width > viewEnd)
			.map((t) => t.value),
		canScrollLeft: scrollLeft > EDGE_SLACK_PX,
		canScrollRight: scrollLeft + clientWidth < scrollWidth - EDGE_SLACK_PX,
	};
}

/**
 * Where to scroll so exactly one more tab comes fully into view.
 *
 * Stepping by a fixed distance leaves tabs sliced in half at the edge, and the
 * last step before either end overshoots: the browser animates to the requested
 * offset and then snaps to the clamped one, which reads as a jump after the
 * animation. Aligning every step to a tab boundary avoids both — the target is
 * always a position some tab's edge sits flush against, and the final step lands
 * exactly on the end of the strip.
 *
 * Returns `null` when there is nothing further to reveal in that direction.
 */
export function scrollLeftForStep(
	tabs: readonly TabBox[],
	direction: -1 | 1,
	scrollLeft: number,
	clientWidth: number,
	scrollWidth: number,
): number | null {
	const max = Math.max(0, scrollWidth - clientWidth);
	const viewEnd = scrollLeft + clientWidth;

	if (direction === 1) {
		// First tab whose right edge is past the viewport: bring that edge flush.
		const next = tabs.find((t) => t.left + t.width > viewEnd + EDGE_SLACK_PX);
		if (!next) return null;
		const target = Math.min(max, next.left + next.width - clientWidth);
		return target > scrollLeft + EDGE_SLACK_PX ? target : null;
	}

	// Last tab starting before the viewport: bring its left edge flush.
	const previous = [...tabs].reverse().find((t) => t.left < scrollLeft - EDGE_SLACK_PX);
	if (!previous) return null;
	const target = Math.max(0, previous.left);
	return target < scrollLeft - EDGE_SLACK_PX ? target : null;
}

/**
 * Where to scroll so `tab` is fully visible, or `null` when it already is.
 * Nudges by the smallest amount that works, so selecting an adjacent tab does
 * not jump the bar across the whole strip.
 */
export function scrollLeftToReveal(
	tab: TabBox,
	scrollLeft: number,
	clientWidth: number,
	scrollWidth: number,
	marginPx = 24,
): number | null {
	const max = Math.max(0, scrollWidth - clientWidth);
	let next: number;
	if (tab.left - marginPx < scrollLeft) {
		next = tab.left - marginPx;
	} else if (tab.left + tab.width + marginPx > scrollLeft + clientWidth) {
		next = tab.left + tab.width + marginPx - clientWidth;
	} else {
		return null;
	}
	const clamped = Math.min(max, Math.max(0, next));
	return Math.abs(clamped - scrollLeft) <= EDGE_SLACK_PX ? null : clamped;
}
