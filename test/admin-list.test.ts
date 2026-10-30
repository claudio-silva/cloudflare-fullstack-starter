import { describe, expect, it } from "vitest";
import { PageLoader, type PageCache } from "../src/react-app/admin/page-loader";
import { clientList } from "../src/react-app/admin/client-list";

// How AdminTable loads its pages (page-loader.ts) and works on a list loaded
// whole (client-list.ts). Neither needs React or a server.

const PS = 10;
const TOTAL = 95;
const ROWS = Array.from({ length: TOTAL }, (_, i) => i + 1);

/** A loader over ROWS whose requests answer only when told to. */
function setup({ cache = false as PageCache, prefetch = true, all = false } = {}) {
	let clock = 0;
	const requests: { offset: number; count: number | "all"; answer: () => Promise<void>; fail: () => Promise<void> }[] = [];
	const loader = new PageLoader<number>(() => clock);
	loader.configure({
		pageSize: PS,
		prefetch,
		cache,
		all,
		fetch: (offset, count) =>
			new Promise((resolve, reject) => {
				const settle = (fn: () => void) => async () => {
					fn();
					await new Promise((r) => setTimeout(r, 0));
				};
				requests.push({
					offset,
					count,
					answer: settle(() => resolve({ rows: count === "all" ? ROWS : ROWS.slice(offset, offset + count), total: TOTAL })),
					fail: settle(() => reject(new Error("offline"))),
				});
			}),
	});
	const asked = () => requests.map((r) => [r.offset, r.count]);
	const shown = () => {
		const s = loader.getSnapshot();
		return { page: s.page, first: s.rows?.[0] ?? null, loading: s.loading, failed: s.failed };
	};
	return { loader, requests, asked, shown, tick: (ms: number) => (clock += ms) };
}

describe("PageLoader", () => {
	it("loads two pages at first, then one ahead of each page shown", async () => {
		const { loader, requests, asked, shown } = setup();
		loader.show(1, "k");
		expect(asked()).toEqual([[0, 20]]);
		expect(shown()).toMatchObject({ page: null, loading: true });
		await requests[0].answer();
		expect(shown()).toEqual({ page: 1, first: 1, loading: false, failed: false });

		// Page 2 came with page 1: it shows at once, and page 3 is asked for alone.
		loader.show(2, "k");
		expect(shown()).toEqual({ page: 2, first: 11, loading: false, failed: false });
		expect(asked()).toEqual([[0, 20], [20, 10]]);
	});

	it("waits for a page still on its way, and asks for the next one meanwhile", async () => {
		const { loader, requests, asked, shown } = setup();
		loader.show(1, "k");
		await requests[0].answer();
		loader.show(2, "k"); // asks for 3
		loader.show(3, "k"); // 3 is on its way: waits, and asks for 4
		expect(asked()).toEqual([[0, 20], [20, 10], [30, 10]]);
		expect(shown()).toMatchObject({ page: 2, loading: true });
		await requests[1].answer();
		expect(shown()).toEqual({ page: 3, first: 21, loading: false, failed: false });
	});

	it("loads a page jumped to with the one after it, in one request", async () => {
		const { loader, requests, asked } = setup();
		loader.show(1, "k");
		await requests[0].answer();
		loader.show(7, "k");
		expect(asked().at(-1)).toEqual([60, 20]);
	});

	it("going back without a cache, loads the page and the one before it, in one request", async () => {
		const { loader, requests, asked, shown } = setup();
		loader.show(7, "k");
		await requests[0].answer(); // pages 7 and 8
		loader.show(6, "k");
		expect(asked().at(-1)).toEqual([40, 20]); // pages 5 and 6
		expect(shown()).toMatchObject({ page: 7, loading: true });
		await requests[1].answer();
		expect(shown()).toMatchObject({ page: 6, first: 51, loading: false });
	});

	it("going back with a cache, shows the page kept and loads the one before it", async () => {
		const { loader, requests, asked, shown } = setup({ cache: { pages: 10, ttl: 60_000 } });
		loader.show(4, "k");
		await requests[0].answer(); // 4 and 5
		loader.show(5, "k"); // asks for 6
		await requests[1].answer();
		loader.show(4, "k");
		expect(shown()).toMatchObject({ page: 4, first: 31, loading: false });
		expect(asked().at(-1)).toEqual([20, 10]); // page 3
	});

	it("asks again for a kept page that expired, showing it meanwhile", async () => {
		const { loader, requests, asked, shown, tick } = setup({ cache: { pages: 10, ttl: 1000 } });
		loader.show(1, "k");
		await requests[0].answer();
		loader.show(2, "k");
		await requests[1].answer();
		tick(5000);
		loader.show(1, "k");
		expect(shown()).toMatchObject({ page: 1, loading: true });
		expect(asked().at(-1)).toEqual([0, 10]);
	});

	it("does not ask beyond the last page", async () => {
		const { loader, requests, asked } = setup();
		loader.show(9, "k");
		await requests[0].answer(); // 9 and 10; the total is now known
		loader.show(10, "k");
		expect(asked()).toEqual([[80, 20]]);
	});

	it("starts over on a new key, dropping the old answers", async () => {
		const { loader, requests, asked, shown } = setup();
		loader.show(3, "a");
		loader.show(1, "b");
		expect(asked()).toEqual([[20, 20], [0, 20]]);
		await requests[0].answer(); // the answer for "a" arrives late
		expect(shown()).toMatchObject({ page: null, loading: true });
		await requests[1].answer();
		expect(shown()).toMatchObject({ page: 1, first: 1 });
	});

	it("reports a failure of the page asked for", async () => {
		const { loader, requests, shown } = setup();
		loader.show(1, "k");
		await requests[0].fail();
		expect(shown()).toEqual({ page: null, first: null, loading: false, failed: true });
	});

	it("without prefetch asks for one page; with all, for every row once", async () => {
		const one = setup({ prefetch: false });
		one.loader.show(1, "k");
		expect(one.asked()).toEqual([[0, 10]]);

		const whole = setup({ all: true });
		whole.loader.show(3, "k");
		expect(whole.asked()).toEqual([[0, "all"]]);
		await whole.requests[0].answer();
		expect(whole.loader.getSnapshot().rows).toHaveLength(TOTAL);
		whole.loader.show(4, "k");
		expect(whole.asked()).toHaveLength(1);
	});
});

describe("clientList", () => {
	type Person = { id: string; name: string; city: string | null; age: number };
	const people: Person[] = [
		{ id: "1", name: "José Silva", city: "Lisboa", age: 40 },
		{ id: "2", name: "Ana Costa", city: null, age: 9 },
		{ id: "3", name: "Rui Silva", city: "Porto", age: 100 },
	];
	const columns = [{ id: "name" }, { id: "city" }, { id: "age", searchable: false }];
	const names = (rows: Person[]) => rows.map((p) => p.name);

	it("searches every word, without case or accents", () => {
		expect(names(clientList(people, { columns, q: "silva jose", sort: null, dir: "asc" }))).toEqual(["José Silva"]);
		expect(names(clientList(people, { columns, q: "porto", sort: null, dir: "asc" }))).toEqual(["Rui Silva"]);
		expect(clientList(people, { columns, q: "100", sort: null, dir: "asc" })).toEqual([]);
	});

	it("sorts numbers as numbers and empty values last either way", () => {
		expect(names(clientList(people, { columns, q: "", sort: "age", dir: "asc" }))).toEqual(["Ana Costa", "José Silva", "Rui Silva"]);
		expect(clientList(people, { columns, q: "", sort: "city", dir: "asc" }).map((p) => p.city)).toEqual(["Lisboa", "Porto", null]);
		expect(clientList(people, { columns, q: "", sort: "city", dir: "desc" }).map((p) => p.city)).toEqual(["Porto", "Lisboa", null]);
	});

	it("filters with the page's callback, once per row, keeping the rows' objects", () => {
		let calls = 0;
		const adults = clientList(people, { columns, q: "", sort: null, dir: "asc", filter: (p) => (calls++, p.age >= 18) });
		expect(calls).toBe(3);
		expect(adults[0]).toBe(people[0]);
		expect(names(adults)).toEqual(["José Silva", "Rui Silva"]);
	});
});
