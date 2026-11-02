import { useLayoutEffect, useRef, type RefObject } from "react";

/**
 * Slides the rows that stay on screen from where they were to where they are
 * now — after a sort, a search or a deletion — instead of letting them jump,
 * so the eye can follow a row to its new place. Rows that just arrived (another
 * page) appear in place. `keys` is the visible rows' keys in order; nothing
 * moves when someone asked the system for reduced motion.
 */
export function useRowMotion(body: RefObject<HTMLElement | null>, keys: string): void {
	const last = useRef(new Map<string, number>());
	useLayoutEffect(() => {
		const rows = Array.from(body.current?.querySelectorAll<HTMLElement>(":scope > tr[data-row-key]") ?? []);
		const before = last.current;
		last.current = new Map(rows.map((row) => [row.dataset.rowKey!, row.offsetTop]));
		if (!before.size || typeof window.matchMedia !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		for (const row of rows) {
			const from = before.get(row.dataset.rowKey!);
			const dy = from === undefined ? 0 : from - row.offsetTop;
			if (Math.abs(dy) < 1) continue;
			row.animate?.([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 320, easing: "cubic-bezier(.2,.7,.2,1)" });
		}
	}, [body, keys]);
}
