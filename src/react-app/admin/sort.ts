// The sort state of a table column, shared by the admin lists.
export type SortDir = "asc" | "desc";

/** The next state of a column's sort: ascending, then descending, then none. */
export function nextSort<F extends string>(current: { sort: F | null; dir: SortDir }, field: F): { sort: F | null; dir: SortDir } {
	if (current.sort !== field) return { sort: field, dir: "asc" };
	return current.dir === "asc" ? { sort: field, dir: "desc" } : { sort: null, dir: "asc" };
}
