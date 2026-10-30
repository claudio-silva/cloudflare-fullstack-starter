// The query protocol of the admin lists: what `AdminTable` sends and what a
// list endpoint reads. docs/ADMIN_TABLE.md, *What the endpoint answers*.
//
//   GET <url>?p=2&ps=20&q=smith&s=-createdAt
//   → { "items": [ … ], "total": 134 }
//
// `p` page (from 1), `ps` rows per page, `q` the search, `s` the sort: a
// field, descending with a leading `-`. Each is left out when it is the
// default (no search, the server's own order).

export type SortDir = "asc" | "desc";

/** Where a list is: page, page size, search and sort. */
export type ListQuery = { page: number; pageSize: number; q: string; sort: string | null; dir: SortDir };

/** The parameter names, also used in the page's address in `AdminTable`'s `"url"` mode. */
export const LIST_PARAMS = { page: "p", pageSize: "ps", q: "q", sort: "s" } as const;

/** `name` / `-name` for a sort, `null` for none. */
export function formatSort(sort: string | null, dir: SortDir): string | null {
	return sort ? `${dir === "desc" ? "-" : ""}${sort}` : null;
}

export function parseSort(value: string | null | undefined): { sort: string | null; dir: SortDir } {
	if (!value) return { sort: null, dir: "asc" };
	return value.startsWith("-") ? { sort: value.slice(1) || null, dir: "desc" } : { sort: value, dir: "asc" };
}

/** The query string's parameters for a list's state. */
export function listParams(query: ListQuery): Record<string, string> {
	const params: Record<string, string> = { [LIST_PARAMS.page]: String(query.page), [LIST_PARAMS.pageSize]: String(query.pageSize) };
	if (query.q) params[LIST_PARAMS.q] = query.q;
	const sort = formatSort(query.sort, query.dir);
	if (sort) params[LIST_PARAMS.sort] = sort;
	return params;
}

/**
 * Reads the protocol on the server. `sortable` is checked here, so a sort that
 * reaches the caller is one of them (or `null`): never put an unchecked one in SQL.
 */
export function parseListQuery<S extends string>(
	read: (name: string) => string | undefined,
	options: { sortable: readonly S[]; pageSize?: number; maxPageSize?: number },
): ListQuery & { sort: S | null } {
	const { sortable, pageSize = 20, maxPageSize = 100 } = options;
	const { sort, dir } = parseSort(read(LIST_PARAMS.sort));
	return {
		page: Math.max(1, Math.floor(Number(read(LIST_PARAMS.page))) || 1),
		pageSize: Math.min(maxPageSize, Math.max(1, Math.floor(Number(read(LIST_PARAMS.pageSize))) || pageSize)),
		q: read(LIST_PARAMS.q)?.trim() ?? "",
		sort: sortable.find((s) => s === sort) ?? null,
		dir,
	};
}
