import { describe, expect, it } from "vitest";
import {
	scrollLeftForStep,
	scrollLeftToReveal,
	tabScrollState,
	type TabBox,
} from "../src/react-app/components/ui/scrollable-tabs-geometry";

const tabs: TabBox[] = [
	{ value: "one", left: 0, width: 100 },
	{ value: "two", left: 100, width: 100 },
	{ value: "three", left: 200, width: 100 },
	{ value: "four", left: 300, width: 100 },
];

describe("tabScrollState", () => {
	it("offers nothing when every tab fits", () => {
		expect(tabScrollState(tabs, 0, 400, 400)).toEqual({
			hidden: [],
			canScrollLeft: false,
			canScrollRight: false,
		});
	});

	it("reports the tabs past the right edge and offers a right scroll", () => {
		expect(tabScrollState(tabs, 0, 250, 400)).toEqual({
			hidden: ["three", "four"],
			canScrollLeft: false,
			canScrollRight: true,
		});
	});

	it("reports the earlier tabs once scrolled to the end", () => {
		expect(tabScrollState(tabs, 150, 250, 400)).toEqual({
			hidden: ["one", "two"],
			canScrollLeft: true,
			canScrollRight: false,
		});
	});

	it("counts a partially visible tab as hidden", () => {
		// `two` spans 100–200 but the viewport ends at 150.
		expect(tabScrollState(tabs, 0, 150, 400).hidden).toContain("two");
	});
});

describe("scrollLeftForStep", () => {
	it("reveals exactly one more tab, aligned to its edge", () => {
		// Viewport 250 of a 400 strip: `three` is sliced. Bring its right edge
		// flush: 300 - 250 = 50. Then `four`: 400 - 250 = 150.
		expect(scrollLeftForStep(tabs, 1, 0, 250, 400)).toBe(50);
		expect(scrollLeftForStep(tabs, 1, 50, 250, 400)).toBe(150);
	});

	it("lands exactly on the end, so the animation is not followed by a snap", () => {
		expect(scrollLeftForStep(tabs, 1, 120, 250, 400)).toBe(150);
		expect(scrollLeftForStep(tabs, 1, 150, 250, 400)).toBeNull();
	});

	it("steps back onto the previous tab's leading edge", () => {
		expect(scrollLeftForStep(tabs, -1, 150, 250, 400)).toBe(100);
		expect(scrollLeftForStep(tabs, -1, 100, 250, 400)).toBe(0);
		expect(scrollLeftForStep(tabs, -1, 0, 250, 400)).toBeNull();
	});

	it("never leaves a tab sliced at the edge it moved towards", () => {
		let at = 0;
		const visited: number[] = [];
		for (let i = 0; i < 10; i++) {
			const next = scrollLeftForStep(tabs, 1, at, 250, 400);
			if (next === null) break;
			at = next;
			visited.push(at);
			const flush = tabs.some((t) => Math.abs(t.left + t.width - (at + 250)) <= 2);
			expect(flush || at === 150, `step to ${at} left a tab sliced`).toBe(true);
		}
		expect(visited).toEqual([50, 150]);
	});
});

describe("scrollLeftToReveal", () => {
	it("does nothing for a tab already in view", () => {
		expect(scrollLeftToReveal(tabs[0]!, 0, 400, 400)).toBeNull();
	});

	it("scrolls just far enough to bring a later tab in", () => {
		expect(scrollLeftToReveal(tabs[3]!, 0, 250, 600)).toBe(174);
	});

	it("scrolls back for an earlier tab, never past the start", () => {
		expect(scrollLeftToReveal(tabs[0]!, 150, 250, 400)).toBe(0);
	});

	it("clamps to the scrollable range", () => {
		expect(scrollLeftToReveal(tabs[3]!, 0, 250, 400)).toBe(150);
	});
});
