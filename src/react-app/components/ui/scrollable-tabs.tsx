import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
	scrollLeftForStep,
	scrollLeftToReveal,
	tabScrollState,
	type TabBox,
} from "./scrollable-tabs-geometry";

/*
 * Naming follows the WAI-ARIA tabs pattern, which shadcn/Radix also use:
 *
 *   tab list  (role="tablist")  — the strip
 *   tab       (role="tab")      — the control that selects a panel; Radix calls
 *                                 its component `TabsTrigger`
 *   tab panel (role="tabpanel") — the content the selected tab reveals
 *
 * So the clickable thing *is* the tab, and the content area is the tab panel —
 * not the other way round.
 */

/** One tab and, optionally, the panel it reveals. */
export type ScrollableTabItem = {
	/** Stable identity, and the value reported by `onValueChange`. */
	value: string;
	/** What the tab shows. A node, so it can carry a flag, an icon or a count. */
	label: ReactNode;
	/** The panel's content. Omit when rendering panels yourself. */
	content?: ReactNode;
	disabled?: boolean;
};

type TabListOwnProps = {
	items: ScrollableTabItem[];
	/** The selected tab, so it can be scrolled into view when it changes. */
	value: string;
	onValueChange?: (value: string) => void;
	className?: string;
	tabClassName?: string;
	/** Accessible name for the strip, when the page does not already supply one. */
	"aria-label"?: string;
};

/**
 * A tab list that scrolls sideways instead of wrapping onto a second line.
 *
 * Wrapping is the thing being avoided: a second row changes the strip's height
 * with the viewport and pushes the panel's content down. This keeps one line and
 * adds the affordances to reach the rest — an arrow at either end, and a menu of
 * exactly the tabs that are not currently visible. Selecting a tab anywhere,
 * including from the menu, scrolls it into view.
 *
 * Use this directly only when you are composing panels yourself inside a Radix
 * `<Tabs>`; otherwise use `<ScrollableTabs>`, which wires both halves together.
 */
export function ScrollableTabList({
	items,
	value,
	onValueChange,
	className,
	tabClassName,
	"aria-label": ariaLabel,
}: TabListOwnProps) {
	const barRef = useRef<HTMLDivElement>(null);
	const scrollerRef = useRef<HTMLDivElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const tabRefs = useRef(new Map<string, HTMLButtonElement>());
	const [state, setState] = useState({
		hidden: [] as string[],
		canScrollLeft: false,
		canScrollRight: false,
	});
	/**
	 * Whether the controls are present at all — decided from the strip's width
	 * against the **bar**, never against the scroller.
	 *
	 * Deciding it from the scroller is circular: showing the controls narrows the
	 * scroller, which hides more tabs, which keeps the controls shown; and the
	 * width the reveal maths used is no longer the width it ends up with, so a tab
	 * scrolled in from the menu lands short. Neither the bar's width nor the
	 * strip's depends on the controls, so this settles in one pass — and the slots
	 * stay reserved (disabled, not removed) so the scroller keeps one width.
	 */
	const [needsControls, setNeedsControls] = useState(false);

	/**
	 * Tab geometry in the scroller's own content coordinates.
	 *
	 * Not `offsetLeft`: that is measured from the nearest *positioned* ancestor,
	 * and tabs are positioned for the active-state border, so it returns an offset
	 * inside some card further up the tree — numbers unrelated to this strip.
	 */
	const boxes = useCallback((): TabBox[] => {
		const scroller = scrollerRef.current;
		if (!scroller) return [];
		const origin = scroller.getBoundingClientRect().left - scroller.scrollLeft;
		const out: TabBox[] = [];
		for (const item of items) {
			const el = tabRefs.current.get(item.value);
			if (!el) continue;
			const rect = el.getBoundingClientRect();
			out.push({
				value: item.value,
				left: Math.round(rect.left - origin),
				width: Math.round(rect.width),
			});
		}
		return out;
	}, [items]);

	const measure = useCallback((): void => {
		const el = scrollerRef.current;
		const bar = barRef.current;
		const list = listRef.current;
		if (!el || !bar || !list) return;
		const strip = list.getBoundingClientRect().width;
		setNeedsControls((prev) => {
			const next = strip > bar.getBoundingClientRect().width + 1;
			return prev === next ? prev : next;
		});
		const next = tabScrollState(boxes(), el.scrollLeft, el.clientWidth, el.scrollWidth);
		setState((prev) =>
			prev.canScrollLeft === next.canScrollLeft
			&& prev.canScrollRight === next.canScrollRight
			&& prev.hidden.length === next.hidden.length
			&& prev.hidden.every((v, i) => v === next.hidden[i])
				? prev
				: next,
		);
	}, [boxes]);

	useEffect(() => {
		const el = scrollerRef.current;
		if (!el) return;
		measure();
		el.addEventListener("scroll", measure, { passive: true });
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		if (barRef.current) ro.observe(barRef.current);
		// The strip grows and shrinks with its labels, not just with the viewport.
		if (listRef.current) ro.observe(listRef.current);
		return (): void => {
			el.removeEventListener("scroll", measure);
			ro.disconnect();
		};
	}, [measure]);

	const reveal = useCallback(
		(tabValue: string): void => {
			const el = scrollerRef.current;
			const box = boxes().find((b) => b.value === tabValue);
			if (!el || !box) return;
			const next = scrollLeftToReveal(box, el.scrollLeft, el.clientWidth, el.scrollWidth);
			if (next === null) return;
			el.scrollTo({ left: next, behavior: "smooth" });
		},
		[boxes],
	);

	/**
	 * Bring the selected tab into view when the selection *changes* — tracked with
	 * a ref rather than the effect's dependencies, because `reveal` is rebuilt
	 * whenever the caller passes a fresh `items` array (i.e. most renders). Keyed
	 * on identity alone, this effect re-ran constantly and dragged the strip back
	 * to the active tab, cancelling every arrow click.
	 */
	const revealedRef = useRef<string | null>(null);
	useLayoutEffect(() => {
		if (revealedRef.current === value) return;
		revealedRef.current = value;
		reveal(value);
	}, [reveal, value]);

	/** One tab per click, landing on that tab's edge — never a sliced tab. */
	const step = (direction: -1 | 1): void => {
		const el = scrollerRef.current;
		if (!el) return;
		const next = scrollLeftForStep(
			boxes(),
			direction,
			el.scrollLeft,
			el.clientWidth,
			el.scrollWidth,
		);
		if (next === null) return;
		el.scrollTo({ left: next, behavior: "smooth" });
	};

	const hiddenItems = items.filter((t) => state.hidden.includes(t.value));
	const controlClass = "mb-1 h-7 w-7 shrink-0 disabled:opacity-30";

	return (
		<div ref={barRef} className={cn("flex min-w-0 items-end gap-1", className)}>
			{needsControls ? (
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className={controlClass}
					disabled={!state.canScrollLeft}
					onClick={() => step(-1)}
					aria-label="Scroll tabs left"
				>
					<ChevronLeft className="h-4 w-4" />
				</Button>
			) : null}

			<div
				ref={scrollerRef}
				// `scrollbar-none`: the arrows are the affordance, and a scrollbar under
				// the strip would cut through the active tab's open bottom edge.
				className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
			>
				<TabsList
					ref={listRef}
					aria-label={ariaLabel}
					className="h-auto w-max flex-nowrap justify-start rounded-none bg-transparent p-0"
				>
					{items.map((item) => (
						<TabsTrigger
							key={item.value}
							value={item.value}
							disabled={item.disabled}
							ref={(el) => {
								if (el) tabRefs.current.set(item.value, el);
								else tabRefs.current.delete(item.value);
							}}
							className={cn(
								"relative shrink-0 whitespace-nowrap rounded-b-none rounded-t-md",
								"border border-transparent px-3 py-2 text-muted-foreground shadow-none",
								/*
								 * The active tab joins the panel below it: `-mb-px` drops it one
								 * pixel so it sits on the strip's bottom rule, its border is the
								 * same `border` token that rule uses, and its own bottom edge is
								 * painted in the panel's background to erase the rule underneath.
								 */
								"-mb-px data-[state=active]:border-border data-[state=active]:border-b-background",
								"data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-none",
								tabClassName,
							)}
						>
							{item.label}
						</TabsTrigger>
					))}
				</TabsList>
			</div>

			{needsControls ? (
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className={controlClass}
					disabled={!state.canScrollRight}
					onClick={() => step(1)}
					aria-label="Scroll tabs right"
				>
					<ChevronRight className="h-4 w-4" />
				</Button>
			) : null}

			{needsControls ? (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className={controlClass}
							disabled={hiddenItems.length === 0}
							aria-label="Show hidden tabs"
						>
							<MoreHorizontal className="h-4 w-4" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						{hiddenItems.map((item) => (
							<DropdownMenuItem
								key={item.value}
								disabled={item.disabled}
								onSelect={() => {
									onValueChange?.(item.value);
									reveal(item.value);
								}}
							>
								{item.label}
							</DropdownMenuItem>
						))}
					</DropdownMenuContent>
				</DropdownMenu>
			) : null}
		</div>
	);
}

export type ScrollableTabsProps = {
	items: ScrollableTabItem[];
	/** Controlled selection. Pair with `onValueChange`. */
	value?: string;
	/** Uncontrolled starting selection; defaults to the first tab. */
	defaultValue?: string;
	onValueChange?: (value: string) => void;
	/** The whole widget. */
	className?: string;
	/** The strip, including its border and background. */
	listClassName?: string;
	tabClassName?: string;
	/** Every panel. */
	panelClassName?: string;
	"aria-label"?: string;
	/**
	 * Render panels yourself instead of from `items[].content` — for panels that
	 * must stay mounted, or that are driven by something other than this list.
	 */
	children?: ReactNode;
};

/**
 * Tab list + tab panels, wired together: selecting a tab shows its panel.
 *
 * What it adds over the shadcn/Radix `Tabs` primitives, none of which they
 * provide: the strip scrolls rather than wrapping, arrows step one tab at a time
 * and land on a tab edge, a menu lists the tabs currently out of view, and the
 * selected tab is always scrolled into view.
 *
 * Controlled (`value` + `onValueChange`) or uncontrolled (`defaultValue`).
 */
export function ScrollableTabs({
	items,
	value,
	defaultValue,
	onValueChange,
	className,
	listClassName,
	tabClassName,
	panelClassName,
	"aria-label": ariaLabel,
	children,
}: ScrollableTabsProps) {
	const [uncontrolled, setUncontrolled] = useState(
		() => defaultValue ?? items[0]?.value ?? "",
	);
	const selected = value ?? uncontrolled;

	const handleChange = useCallback(
		(next: string): void => {
			if (value === undefined) setUncontrolled(next);
			onValueChange?.(next);
		},
		[onValueChange, value],
	);

	return (
		<Tabs
			value={selected}
			onValueChange={handleChange}
			className={cn("flex min-h-0 flex-col overflow-hidden", className)}
		>
			<div className={cn("flex shrink-0 items-end border-b px-3 pt-3", listClassName)}>
				<ScrollableTabList
					items={items}
					value={selected}
					onValueChange={handleChange}
					tabClassName={tabClassName}
					aria-label={ariaLabel}
					className="flex-1"
				/>
			</div>
			{children
				?? items.map((item) => (
					<TabsContent
						key={item.value}
						value={item.value}
						className={cn("mt-0 min-h-0 flex-1 overflow-auto", panelClassName)}
					>
						{item.content}
					</TabsContent>
				))}
		</Tabs>
	);
}
