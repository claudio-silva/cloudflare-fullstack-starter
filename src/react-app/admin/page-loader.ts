/**
 * Loads the pages of an `AdminTable`: which rows to ask for, what to keep, and
 * what to show while they come. No React in here; the table renders its
 * snapshot through `useSyncExternalStore`. docs/ADMIN_TABLE.md, *Loading ahead*.
 *
 * Moving to page k asks for k and, with `prefetch`, for the page after it in
 * the direction of travel (k + 1 forwards or after a jump, k - 1 backwards).
 * Whatever of the two is missing, and not already on its way, is asked for in
 * one request: both pages at once when both are missing (the first load, a
 * jump, going back with nothing kept), otherwise the one. So paging forward
 * shows the page that was loaded ahead and loads the next; clicking faster than
 * the answers come waits for the page, and still asks for the next one.
 *
 * `cache` keeps the pages seen, up to `pages`, for `ttl` milliseconds: going
 * back is then instant, and an expired page shows while it is asked again.
 * Without it only the page shown and the one ahead are kept.
 */

export type LoadedRows<T> = { rows: T[]; total: number };

export type PageCache = false | { pages: number; ttl: number };

export type PageLoaderOptions<T> = {
	pageSize: number;
	prefetch: boolean;
	cache: PageCache;
	/** Every row at once (`c=all`): one page holding all of them. */
	all: boolean;
	fetch: (offset: number, count: number | "all") => Promise<LoadedRows<T>>;
};

export type PageSnapshot<T> = {
	/** The page whose rows are shown: the one asked for, or the last one shown while it loads. */
	page: number | null;
	rows: T[] | null;
	total: number | null;
	/** The page asked for is not in yet, or is being asked again. */
	loading: boolean;
	/** The page asked for could not be loaded. */
	failed: boolean;
};

export class PageLoader<T> {
	private options: PageLoaderOptions<T> | null = null;
	private key: string | null = null;
	/** Answers to requests of an earlier key are dropped. */
	private generation = 0;
	private pages = new Map<number, { rows: T[]; at: number }>();
	private inflight = new Set<number>();
	private total: number | null = null;
	private current = 0;
	/** The pages kept without a cache: the one shown and the one ahead. */
	private retained: number[] = [];
	private failedPage: number | null = null;
	private listeners = new Set<() => void>();
	private snapshot: PageSnapshot<T> = { page: null, rows: null, total: null, loading: true, failed: false };

	constructor(private now: () => number = Date.now) {}

	configure(options: PageLoaderOptions<T>) {
		this.options = options;
	}

	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => void this.listeners.delete(listener);
	};

	getSnapshot = () => this.snapshot;

	/** Shows `page` of the list `key` (its search, sort, filters…): a new key starts over. */
	show(page: number, key: string) {
		const { all, prefetch, cache } = this.opts();
		if (key !== this.key) {
			this.key = key;
			this.generation++;
			this.pages.clear();
			this.inflight.clear();
			this.total = null;
			this.current = 0;
			this.failedPage = null;
		}
		const target = all ? 1 : Math.max(1, page);
		const step = target - this.current;
		this.current = target;
		if (this.failedPage !== target) this.failedPage = null;

		const ahead = !all && prefetch ? (step === -1 ? target - 1 : target + 1) : null;
		const wanted = ahead !== null && this.exists(ahead) ? [target, ahead] : [target];
		this.retained = wanted;
		if (!cache) this.trim();

		const missing = wanted.filter((p) => !this.fresh(p) && !this.inflight.has(p)).sort((a, b) => a - b);
		if (missing.length === 2 && missing[1] - missing[0] === 1) this.request(missing[0], 2);
		else for (const p of missing) this.request(p, 1);
		this.emit();
	}

	private opts(): PageLoaderOptions<T> {
		if (!this.options) throw new Error("PageLoader: configure() first");
		return this.options;
	}

	private exists(page: number) {
		return page >= 1 && (this.total === null || (page - 1) * this.opts().pageSize < this.total);
	}

	private fresh(page: number) {
		const entry = this.pages.get(page);
		const { cache } = this.opts();
		return entry !== undefined && (!cache || this.now() - entry.at < cache.ttl);
	}

	private request(first: number, count: number) {
		const { pageSize, all, fetch } = this.opts();
		const generation = this.generation;
		const pages = Array.from({ length: count }, (_, i) => first + i);
		for (const p of pages) this.inflight.add(p);
		fetch(all ? 0 : (first - 1) * pageSize, all ? "all" : count * pageSize)
			.then(
				({ rows, total }) => {
					if (generation !== this.generation) return;
					this.total = total;
					const at = this.now();
					if (all) this.pages.set(1, { rows, at });
					else
						pages.forEach((p, i) => {
							// The first page always (it may be the empty list); the others if the list reaches them.
							if (i === 0 || (p - 1) * pageSize < total) this.pages.set(p, { rows: rows.slice(i * pageSize, (i + 1) * pageSize), at });
						});
					if (this.failedPage !== null && pages.includes(this.failedPage)) this.failedPage = null;
				},
				() => {
					if (generation === this.generation && pages.includes(this.current)) this.failedPage = this.current;
				},
			)
			.finally(() => {
				if (generation !== this.generation) return;
				for (const p of pages) this.inflight.delete(p);
				this.trim();
				this.emit();
			});
	}

	/** Without a cache, keeps the page shown and the one ahead; with one, the `pages` nearest the one shown. */
	private trim() {
		const { cache } = this.opts();
		if (!cache) {
			for (const p of [...this.pages.keys()]) if (!this.retained.includes(p)) this.pages.delete(p);
			return;
		}
		const extra = this.pages.size - cache.pages;
		if (extra <= 0) return;
		const farthest = [...this.pages.keys()].sort((a, b) => Math.abs(b - this.current) - Math.abs(a - this.current));
		for (const p of farthest.slice(0, extra)) this.pages.delete(p);
	}

	private emit() {
		const entry = this.pages.get(this.current);
		const previous = this.snapshot;
		const next: PageSnapshot<T> = {
			page: entry ? this.current : previous.page,
			rows: entry ? entry.rows : previous.rows,
			total: this.total ?? previous.total,
			loading: this.inflight.has(this.current) || (!entry && this.failedPage !== this.current),
			failed: !entry && this.failedPage === this.current && !this.inflight.has(this.current),
		};
		const same = (Object.keys(next) as (keyof PageSnapshot<T>)[]).every((k) => next[k] === previous[k]);
		if (same) return;
		this.snapshot = next;
		for (const listener of this.listeners) listener();
	}
}
