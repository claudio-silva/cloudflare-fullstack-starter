import { useCallback, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { LIST_PARAMS, formatSort, parseSort, type ListQuery } from "../../shared/admin-list";

/** A list's state, and how to change it: what `useAdminList` returns. */
export type AdminList = ListQuery & {
	/** Changes the state. A new search, sort or page size goes back to page 1, unless `page` is given too. */
	update: (changes: Partial<ListQuery>) => void;
};

/**
 * The state of a list (page, page size, search, sort), for a page that needs
 * it outside the table: to load the rows itself, to show it, or to change it
 * from a form of its own. Pass the result to `AdminTable` as `list`.
 *
 * `"url"` keeps it in the address under the protocol's names (`?p=2&q=smith&s=-createdAt`),
 * `"local"` in the component. `ps` is in the address only when it is not `pageSize`.
 */
export function useAdminList({ state = "url", pageSize = 20 }: { state?: "url" | "local"; pageSize?: number } = {}): AdminList {
	const [searchParams, setSearchParams] = useSearchParams();
	const [local, setLocal] = useState<Record<string, string>>({});

	const update = useCallback(
		(changes: Partial<ListQuery>) => {
			// Worked out from the previous state, so two changes in a row both count.
			const apply = (from: (name: string) => string | null | undefined) => write(next(read(from, pageSize), changes), pageSize);
			if (state === "local") {
				setLocal((prev) => {
					const out: Record<string, string> = {};
					for (const [key, value] of Object.entries(apply((name) => prev[name]))) if (value) out[key] = value;
					return out;
				});
				return;
			}
			setSearchParams(
				(prev) => {
					const out = new URLSearchParams(prev);
					for (const [key, value] of Object.entries(apply((name) => prev.get(name)))) {
						if (value) out.set(key, value);
						else out.delete(key);
					}
					return out;
				},
				{ replace: true },
			);
		},
		[state, pageSize, setSearchParams],
	);
	return { ...read((name) => (state === "url" ? searchParams.get(name) : local[name]), pageSize), update };
}

function read(from: (name: string) => string | null | undefined, pageSize: number): ListQuery {
	return {
		page: Math.max(1, Math.floor(Number(from(LIST_PARAMS.page))) || 1),
		pageSize: Math.max(1, Math.floor(Number(from(LIST_PARAMS.pageSize))) || pageSize),
		q: from(LIST_PARAMS.q) ?? "",
		...parseSort(from(LIST_PARAMS.sort)),
	};
}

/** The protocol's parameters for a state; `null` for those at their default. */
function write(query: ListQuery, pageSize: number): Record<string, string | null> {
	return {
		[LIST_PARAMS.page]: query.page > 1 ? String(query.page) : null,
		[LIST_PARAMS.pageSize]: query.pageSize !== pageSize ? String(query.pageSize) : null,
		[LIST_PARAMS.q]: query.q || null,
		[LIST_PARAMS.sort]: formatSort(query.sort, query.dir),
	};
}

function next(prev: ListQuery, changes: Partial<ListQuery>): ListQuery {
	const merged = { ...prev, ...changes };
	const refiltered = merged.q !== prev.q || merged.sort !== prev.sort || merged.dir !== prev.dir || merged.pageSize !== prev.pageSize;
	return refiltered && changes.page === undefined ? { ...merged, page: 1 } : merged;
}
