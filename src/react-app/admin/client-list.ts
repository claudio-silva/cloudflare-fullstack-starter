import type { SortDir } from "../../shared/admin-list";

/**
 * Filtering, search and sort in the browser, for an `AdminTable` with
 * `fullData`: the whole list is loaded once, and this works out what to show.
 * The result is an array of the same row objects, not copies.
 */

/** What of a column this needs (a subset of `AdminColumn`). */
export type ClientColumn<T> = {
	id: string;
	sortKey?: string;
	sortValue?: (row: T) => unknown;
	searchValue?: (row: T) => unknown;
	searchable?: boolean;
};

export type ClientListOptions<T> = {
	columns: ClientColumn<T>[];
	filter?: (row: T) => boolean;
	q: string;
	sort: string | null;
	dir: SortDir;
};

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Lower case and without accents, so "jose" finds "José". */
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const isEmpty = (value: unknown) => value === null || value === undefined || value === "";

const property = <T,>(row: T, key: string) => (row as Record<string, unknown>)[key];

export function clientList<T>(rows: T[], { columns, filter, q, sort, dir }: ClientListOptions<T>): T[] {
	let out = filter ? rows.filter((row) => filter(row)) : rows;

	const terms = fold(q).split(/\s+/).filter(Boolean);
	if (terms.length > 0) {
		const searched = columns.filter((c) => c.searchable !== false);
		// Every word must be somewhere in the row.
		out = out.filter((row) => {
			const text = fold(
				searched
					.map((c) => (c.searchValue ? c.searchValue(row) : property(row, c.id)))
					.filter((v) => typeof v === "string" || typeof v === "number")
					.join(" "),
			);
			return terms.every((term) => text.includes(term));
		});
	}

	const column = sort ? columns.find((c) => (c.sortKey ?? c.id) === sort) : undefined;
	if (column) {
		const value = (row: T) => (column.sortValue ? column.sortValue(row) : property(row, column.sortKey ?? column.id));
		const sign = dir === "desc" ? -1 : 1;
		// A copy, so the loaded rows keep their order; empty values last either way, as on the server.
		out = [...out].sort((a, b) => {
			const va = value(a);
			const vb = value(b);
			if (isEmpty(va) || isEmpty(vb)) return isEmpty(va) === isEmpty(vb) ? 0 : isEmpty(va) ? 1 : -1;
			return sign * compare(va, vb);
		});
	}
	return out;
}

function compare(a: unknown, b: unknown): number {
	if (typeof a === "number" && typeof b === "number") return a - b;
	if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
	if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
	return collator.compare(String(a), String(b));
}
