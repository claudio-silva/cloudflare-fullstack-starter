// The query protocol of the admin lists: what `AdminTable` asks and what a
// list endpoint reads. docs/ADMIN_TABLE.md, *What the endpoint answers*.
//
//   GET <url>?ofs=40&c=40&q=smith&s=-createdAt
//   → { "items": [ … ], "total": 134 }
//
// `ofs` the first row (from 0), `c` how many rows (`all` where the endpoint
// allows it), `q` the search, `s` the sort: a field, descending with a leading
// `-`. Pages are the browser's business: it asks for rows, which lets it load
// two pages in one query, or a page ahead of the one shown.

export type SortDir = "asc" | "desc";

/** Rows per page when nobody says otherwise, in the table and on the server. */
export const DEFAULT_PAGE_SIZE = 20;
/** The most rows on a page. */
export const MAX_PAGE_SIZE = 100;
/** The most rows one request may ask for (two pages, loading one ahead), short of `all`. */
export const MAX_LIST_COUNT = 2 * MAX_PAGE_SIZE;
/** What `c=all` returns at most: a list loaded whole is meant to be small. */
export const MAX_LIST_ALL = 2000;

/** What the browser asks for. */
export type ListRequest = { offset: number; count: number | "all"; q: string; sort: string | null; dir: SortDir };

/** The parameter names on the wire. */
export const LIST_REQUEST_PARAMS = { offset: "ofs", count: "c", q: "q", sort: "s" } as const;

/** `name` / `-name` for a sort, `null` for none. */
export function formatSort(sort: string | null, dir: SortDir): string | null {
	return sort ? `${dir === "desc" ? "-" : ""}${sort}` : null;
}

export function parseSort(value: string | null | undefined): { sort: string | null; dir: SortDir } {
	if (!value) return { sort: null, dir: "asc" };
	return value.startsWith("-") ? { sort: value.slice(1) || null, dir: "desc" } : { sort: value, dir: "asc" };
}

/** The query string's parameters for a request. */
export function listParams(request: ListRequest): Record<string, string> {
	const params: Record<string, string> = { [LIST_REQUEST_PARAMS.offset]: String(request.offset), [LIST_REQUEST_PARAMS.count]: String(request.count) };
	if (request.q) params[LIST_REQUEST_PARAMS.q] = request.q;
	const sort = formatSort(request.sort, request.dir);
	if (sort) params[LIST_REQUEST_PARAMS.sort] = sort;
	return params;
}

/**
 * Reads the protocol on the server. `sortable` is checked here, so a sort that
 * reaches the caller is one of them (or `null`): never put an unchecked one in
 * SQL. `c=all` is honoured only with `allowAll`, up to `MAX_LIST_ALL` rows;
 * otherwise `count` is at most `MAX_LIST_COUNT`.
 */
export function parseListQuery<S extends string>(
	read: (name: string) => string | undefined,
	options: { sortable: readonly S[]; allowAll?: boolean },
): { offset: number; count: number; q: string; sort: S | null; dir: SortDir } {
	const { sort, dir } = parseSort(read(LIST_REQUEST_PARAMS.sort));
	const countParam = read(LIST_REQUEST_PARAMS.count);
	const count =
		countParam === "all" && options.allowAll
			? MAX_LIST_ALL
			: Math.min(MAX_LIST_COUNT, Math.max(1, Math.floor(Number(countParam)) || DEFAULT_PAGE_SIZE));
	return {
		offset: Math.max(0, Math.floor(Number(read(LIST_REQUEST_PARAMS.offset))) || 0),
		count,
		q: read(LIST_REQUEST_PARAMS.q)?.trim() ?? "",
		sort: options.sortable.find((s) => s === sort) ?? null,
		dir,
	};
}
