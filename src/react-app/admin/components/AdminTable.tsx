import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { EllipsisVertical, ListChecks, RotateCw, Search, Trash2, X, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Toggle } from "@/components/ui/toggle";
import { http, isHandledHttpError } from "@/lib/http";
import { cn } from "@/lib/utils";
import { listParams, type ListRequest } from "../../../shared/admin-list";
import { clientList } from "../client-list";
import { adminConfig } from "../config";
import { PageLoader, type LoadedRows, type PageCache } from "../page-loader";
import { nextSort } from "../sort";
import { useAdminList, type AdminList } from "../use-admin-list";
import { ACTION_BUTTON, ORDINAL } from "../styles";
import { PageBar } from "./PageBar";
import { SortHeader } from "./SortHeader";

/**
 * The admin area's table: a server-backed list with the toolbar, row numbers,
 * sortable headings, selection, row menus, bulk actions, pages and the
 * loading and empty states every list here shares. docs/ADMIN_TABLE.md has the
 * guide; the props below are the reference.
 *
 * Where the rows come from, from the simplest to the most open:
 *
 *  - `url`: the table asks `GET <url>?ofs=0&c=40[&q=…][&s=-field]` and reads
 *    `{ items, total }` (src/shared/admin-list.ts); `params` adds parameters
 *    (an external filter form, say), `queryParams` replaces the standard ones;
 *  - `load`: any request, given the rows wanted;
 *  - neither: the page passes `data` itself (a websocket, a store), and reads
 *    the state from `useAdminList`, which it hands to the table as `list`.
 *
 * Pages are worked out here: the table asks for rows, two pages at a time
 * when it can, and one ahead of the page shown (page-loader.ts). With
 * `fullData` it asks for every row once and searches, sorts and pages in the
 * browser (client-list.ts).
 */

export type { ListRequest } from "../../../shared/admin-list";
export type { ListQuery } from "../use-admin-list";

/** What a list endpoint returns by default. */
export type ListResponse<T> = { items: T[]; total: number };

export type AdminColumn<T> = {
	/** Unique in the table. The sort key sent to the server, unless `sortKey` says otherwise. */
	id: string;
	header: ReactNode;
	/** The cell's content. Defaults to the row's property named `id`, or "—" when empty. */
	cell?: (row: T) => ReactNode;
	/** Sorts on the server: the heading cycles ascending, descending, none. */
	sortable?: boolean;
	sortKey?: string;
	/** With `fullData`: what the browser sorts by. Defaults to the property `sortKey` or `id`. */
	sortValue?: (row: T) => unknown;
	/** With `fullData`: the text the search looks in. Defaults to the property `id`, when it is text or a number. */
	searchValue?: (row: T) => unknown;
	/** With `fullData`: `false` leaves the column out of the search. */
	searchable?: boolean;
	/** Fixed width in pixels, for content of a known size. Without it the column takes the room left. */
	width?: number;
	/** Hidden on screens narrower than this breakpoint. */
	hideBelow?: "sm" | "md" | "lg" | "xl";
	/** Grey text, for secondary values such as dates. */
	muted?: boolean;
	align?: "left" | "center" | "right";
	/** Content is cut to one line with an ellipsis; `wrap` lets it take several. */
	wrap?: boolean;
	/** Tooltip of the cell, e.g. the full value behind a shortened one. */
	title?: (row: T) => string | null | undefined;
	/** Extra classes for the heading and the cells. */
	className?: string;
};

/** An entry of a row's menu (the ⋮ button at the end of the row). */
export type RowAction<T> = {
	label: string;
	icon?: LucideIcon;
	/** Red, for what destroys. */
	destructive?: boolean;
	/** Asked first, in a dialog. */
	confirm?: Confirmation;
	/** A returned promise reloads the list when it settles. */
	onSelect: (row: T) => void | Promise<void>;
};

/** An action on the selected rows, in the toolbar while selecting. */
export type BulkAction<T> = {
	label: string;
	icon?: LucideIcon;
	destructive?: boolean;
	confirm?: (count: number) => Confirmation;
	/** The list reloads, and the selection ends, when it settles. */
	run: (ids: string[], rows: T[]) => Promise<void>;
};

export type Confirmation = { title: ReactNode; description?: ReactNode; action?: string };

export type AdminTableProps<T, D = ListResponse<T>> = {
	/** The list endpoint, asked with the standard query (`ofs`, `c`, `q`, `s`). */
	url?: string;
	/** Added to every request's query, e.g. an external filter form's fields or the locale. A change loads the list again. */
	params?: Record<string, string | undefined>;
	/** Replaces the standard query parameters, for an endpoint that speaks another protocol. `params` are still added. */
	queryParams?: (request: ListRequest) => Record<string, string>;
	/**
	 * Replaces the request: loads the rows asked for. Called as pages are
	 * needed, and again when the search, sort, `params` or `reloadKey` change.
	 * Without `url` and `load`, the rows come from `data`.
	 */
	load?: (request: ListRequest) => Promise<D>;
	/**
	 * Loads every row once (`c=all`, which the endpoint must allow) and
	 * searches, sorts and pages in the browser: for lists known to stay small
	 * (up to `MAX_LIST_ALL` rows). With `data`, `data` holds every row.
	 */
	fullData?: boolean;
	/** With `fullData`: which rows to show, e.g. from an external search form. Keep it stable (`useCallback`): a new one filters again. */
	filter?: (row: T) => boolean;
	/** Loads the page after the one shown (or before, going back) with it. Default: `adminConfig.table.prefetch`. */
	prefetch?: boolean;
	/** Pages kept for going back, `{ pages, ttl }`, or `false`. Default: `adminConfig.table.cache`. */
	cache?: PageCache;
	/** Rows loaded outside the table; `null` until there are some. Only when there is no `url` or `load`. */
	data?: D | null;
	/** With `data`: a load is under way, so the rows show dimmed. */
	loading?: boolean;
	/** With `data`: the load failed, so the table offers Try again (which calls `onReload`). */
	failed?: boolean;
	/** With `data`: the table needs the rows again (Try again, or an action finished). */
	onReload?: () => void;
	/** Takes the rows out of the response. Defaults to its `items`. */
	rows?: (data: D) => T[];
	/** Takes the total out of the response. Defaults to its `total`. */
	total?: (data: D) => number;
	/**
	 * The list's state (page, search, sort), from `useAdminList`, for a page
	 * that reads or changes it outside the table. Without it the table keeps
	 * its own, as `state` and `pageSize` say.
	 */
	list?: AdminList;
	/** Identifies a row. Defaults to its `id`. */
	rowKey?: (row: T) => string;
	columns: AdminColumn<T>[];
	/** Rows per page. Default `DEFAULT_PAGE_SIZE` (src/shared/admin-list.ts). (With `list`, its own.) */
	pageSize?: number;
	/**
	 * Where search, sort and page are kept. `"url"` (default): in the address,
	 * so returning to the page brings the list back as it was. `"local"`: in the
	 * component, for a table that is part of another page (a tab, a panel).
	 * (With `list`, its own.)
	 */
	state?: "url" | "local";
	/** What a row is, for the count and the messages: `["user", "users"]`. Default `["record", "records"]`. */
	noun?: [singular: string, plural: string];
	/** A search box with this placeholder; the server gets the text as `q` (with `fullData`, the browser searches). */
	search?: string;
	/** Text or markup in the toolbar, e.g. what the list contains. Shown beside the search box, or in its place. */
	intro?: ReactNode;
	/** The `#` column. Default true. */
	ordinal?: boolean;
	/** Every other row shaded. Default: `adminConfig.table.striped`. */
	striped?: boolean;
	/** `"compact"`: shorter rows. Default: `adminConfig.table.density`. */
	density?: "normal" | "compact";
	/** Where a click on a row leads. */
	rowHref?: (row: T) => string;
	/** What a click on a row does, when it is not a link. */
	onRowClick?: (row: T) => void;
	/** The row menu's entries. */
	rowActions?: (row: T) => RowAction<T>[];
	/**
	 * Deleting rows: from each row's menu and, after Select, several at once.
	 * `url` gives the `DELETE` endpoint of one row; they are deleted one at a
	 * time, so the server's rules apply to each. `run` replaces that.
	 */
	deletable?: { url?: (id: string) => string; run?: (ids: string[]) => Promise<void>; description?: ReactNode };
	/** Actions on the selected rows besides deleting. Any of these, or `deletable`, adds the Select toggle. */
	bulkActions?: BulkAction<T>[];
	/** The message when there are no rows. Defaults to one built from `noun`. */
	empty?: ReactNode | ((query: string) => ReactNode);
	/** Change it to load the list again. */
	reloadKey?: unknown;
};

const HIDE_BELOW = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell", xl: "hidden xl:table-cell" } as const;
const ALIGN = { left: "", center: "text-center", right: "text-right" } as const;
/** Darker than shadcn's default, so a checkbox shows against the shaded headings. */
const CHECKBOX = "mx-auto block border-neutral-500 dark:border-neutral-400";
/** As wide as the row-number column, with the content in the middle. */
const NARROW = "w-[50px] min-w-[50px] max-w-[50px] px-0 text-center";
/** Row colours from admin.css; the selected one wins over the stripe and the hover. */
const ROW = "hover:bg-(--admin-table-row-hover) has-aria-expanded:bg-(--admin-table-row-hover) data-[state=selected]:bg-(--admin-table-row-selected)!";
const STRIPE = "even:bg-(--admin-table-stripe)";
/** Shorter rows: less padding in the body's cells. */
const COMPACT = "[&_tbody_td]:py-1 [&_tbody_th]:py-1";
/** The loading, empty and failed states: a panel of one height, with the message in the middle. */
const PANEL_HEIGHT = "h-64";

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function AdminTable<T, D = ListResponse<T>>(props: AdminTableProps<T, D>) {
	const {
		url,
		params,
		columns,
		fullData = false,
		filter,
		prefetch = adminConfig.table.prefetch,
		cache = adminConfig.table.cache,
		noun = ["record", "records"],
		search: searchPlaceholder,
		intro,
		ordinal = true,
		striped = adminConfig.table.striped,
		density = adminConfig.table.density,
		rowHref,
		onRowClick,
		rowActions,
		deletable,
		bulkActions = [],
		empty,
		reloadKey,
	} = props;
	const rowsOf = props.rows ?? ((data: D) => (data as unknown as ListResponse<T>).items);
	const totalOf = props.total ?? ((data: D) => (data as unknown as ListResponse<T>).total);
	const keyOf = props.rowKey ?? ((row: T) => String((row as { id: unknown }).id));
	const navigate = useNavigate();

	const own = useAdminList({ state: props.state, pageSize: props.pageSize });
	const list = props.list ?? own;
	const { q, page, pageSize, dir } = list;
	const sortable = columns.filter((c) => c.sortable).map((c) => c.sortKey ?? c.id);
	const sort = sortable.find((s) => s === list.sort) ?? null;
	/** The rows come from the page (`data`), not from a request of the table's. */
	const external = !url && !props.load;

	const [searchText, setSearchText] = useState(q);
	const [seenQ, setSeenQ] = useState(q);
	if (q !== seenQ) {
		// The search changed from outside (another page, a form): show it in the box.
		setSeenQ(q);
		if (q !== searchText.trim()) setSearchText(q);
	}
	const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
	const [reloads, setReloads] = useState(0);
	const [selecting, setSelecting] = useState(false);
	const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
	const [busy, setBusy] = useState(false);
	/** The open confirmation, and what it runs once confirmed. */
	const [pending, setPending] = useState<{ confirm: Confirmation; destructive?: boolean; icon?: LucideIcon; run: () => Promise<void> } | null>(null);

	const plural = noun[1];
	const paramsKey = JSON.stringify(params ?? {});
	const [loader] = useState(() => new PageLoader<T>());
	const snapshot = useSyncExternalStore(loader.subscribe, loader.getSnapshot);
	// Kept current every render, so a request made later (a page ahead) asks with the props of now.
	useEffect(() => {
		const fetchRows = (offset: number, count: number | "all"): Promise<LoadedRows<T>> => {
			const request: ListRequest = fullData ? { offset: 0, count: "all", q: "", sort: null, dir: "asc" } : { offset, count, q, sort, dir };
			const response = props.load
				? props.load(request)
				: (() => {
						const search = new URLSearchParams(props.queryParams ? props.queryParams(request) : listParams(request));
						for (const [key, value] of Object.entries(params ?? {})) if (value !== undefined) search.set(key, value);
						return http(`${url}${url!.includes("?") ? "&" : "?"}${search}`).then((res) => res.json() as Promise<D>);
					})();
			return response.then(
				(data) => ({ rows: rowsOf(data), total: totalOf(data) }),
				(error: unknown) => {
					// A failure has been shown by the HTTP layer; the list keeps what it had.
					if (!isHandledHttpError(error)) toast.error(`The ${plural} could not be loaded.`);
					throw error;
				},
			);
		};
		loader.configure({ pageSize, prefetch, cache, all: fullData, fetch: fetchRows });
	});
	/** What, changed, makes the loaded rows useless: with `fullData`, only what reaches the server. */
	const listKey = JSON.stringify(fullData ? [url, paramsKey, reloads, String(reloadKey)] : [url, paramsKey, q, sort, dir, pageSize, reloads, String(reloadKey)]);
	useEffect(() => {
		if (!external) loader.show(page, listKey);
	}, [external, loader, page, listKey]);

	/** Every row, when the browser does the work. */
	const allRows = fullData ? (external ? (props.data ? rowsOf(props.data) : null) : snapshot.rows) : null;
	const worked = useMemo(() => (allRows ? clientList(allRows, { columns, filter, q, sort, dir }) : null), [allRows, columns, filter, q, sort, dir]);

	let rows: T[] | null;
	let total: number | null;
	let shownPage: number;
	if (worked) {
		rows = worked.slice((page - 1) * pageSize, page * pageSize);
		total = worked.length;
		shownPage = page;
	} else if (external) {
		rows = !fullData && props.data ? rowsOf(props.data) : null;
		total = !fullData && props.data ? totalOf(props.data) : null;
		shownPage = page;
	} else {
		rows = fullData ? null : snapshot.rows;
		total = snapshot.total;
		shownPage = snapshot.page ?? page;
	}
	const loading = external ? Boolean(props.loading) || !props.data : snapshot.loading;
	const failed = external ? Boolean(props.failed) : snapshot.failed;
	const shown = rows !== null;
	const visible = rows ?? [];
	const pages = Math.max(1, Math.ceil((total ?? 0) / pageSize));
	const firstOrdinal = (shownPage - 1) * pageSize + 1;

	// A page past the end (the last rows were deleted, a shorter search): go to the last one.
	useEffect(() => {
		if (shown && !loading && total !== null && page > pages) list.update({ page: pages });
	}, [shown, loading, total, page, pages, list]);

	const reload = () => (external ? props.onReload?.() : setReloads((n) => n + 1));
	/** Only rows on screen: rows that went away (another page, pushed data) are no longer selected. */
	const selectedRows = visible.filter((r) => selected.has(keyOf(r)));

	const onSearch = (value: string) => {
		setSearchText(value);
		clearTimeout(searchTimer.current);
		// Search as the user types, once they pause.
		searchTimer.current = setTimeout(() => {
			list.update({ q: value.trim() });
			setSelected(new Set());
		}, 300);
	};
	const onSort = (field: string) => {
		list.update(nextSort({ sort, dir }, field));
		setSelected(new Set());
	};
	const onPage = (n: number) => {
		list.update({ page: n });
		setSelected(new Set());
	};

	// Deleting is the common bulk action, so it is built in.
	const deleteRows = deletable
		? async (ids: string[]) => {
				if (deletable.run) return deletable.run(ids);
				let done = 0;
				try {
					for (const id of ids) {
						await http(deletable.url!(id), { method: "DELETE" });
						done++;
					}
				} finally {
					if (done > 0) toast.success(done === 1 ? `${capitalize(noun[0])} deleted.` : `${done} ${noun[1]} deleted.`);
				}
			}
		: null;
	const deleteConfirm = (count: number): Confirmation => ({
		title: `Delete ${count === 1 ? `this ${noun[0]}` : `${count} ${noun[1]}`}?`,
		description: deletable?.description ?? "This cannot be undone.",
		action: "Delete",
	});
	const allBulk: BulkAction<T>[] = [
		...bulkActions,
		...(deleteRows ? [{ label: "Delete", icon: Trash2, destructive: true, confirm: deleteConfirm, run: (ids: string[]) => deleteRows(ids) }] : []),
	];
	const menuFor = (row: T): RowAction<T>[] => [
		...(rowActions?.(row) ?? []),
		...(deleteRows ? [{ label: "Delete", icon: Trash2, destructive: true, confirm: deleteConfirm(1), onSelect: (r: T) => deleteRows([keyOf(r)]) }] : []),
	];
	const hasMenu = Boolean(rowActions || deleteRows);
	const canSelect = allBulk.length > 0;

	/** Runs an action, after its confirmation if it has one; reloads when it is done. */
	const perform: Perform = (run, confirm, destructive, icon) => {
		const go = async () => {
			setPending(null);
			const result = run();
			if (!(result instanceof Promise)) return;
			setBusy(true);
			try {
				await result;
			} catch (error) {
				if (!isHandledHttpError(error)) toast.error("That could not be completed.");
			} finally {
				setBusy(false);
				setSelecting(false);
				setSelected(new Set());
				reload();
			}
		};
		if (confirm) setPending({ confirm, destructive, icon, run: go });
		else void go();
	};

	const allSelected = visible.length > 0 && selectedRows.length === visible.length;
	const toggleRow = (id: string) =>
		setSelected((prev) => {
			const next = new Set(prev);
			if (!next.delete(id)) next.add(id);
			return next;
		});
	const toggleSelecting = (on: boolean) => {
		setSelecting(on);
		setSelected(new Set());
	};

	const clickable = Boolean(rowHref || onRowClick);
	const onRow = (row: T) => {
		if (selecting) return toggleRow(keyOf(row));
		if (rowHref) navigate(rowHref(row));
		else onRowClick?.(row);
	};

	const columnClass = (c: AdminColumn<T>) => cn(c.hideBelow && HIDE_BELOW[c.hideBelow], c.align && ALIGN[c.align], c.className);
	const columnStyle = (c: AdminColumn<T>): CSSProperties | undefined => (c.width ? { width: c.width, minWidth: c.width } : undefined);
	const span = columns.length + (ordinal ? 1 : 0) + (selecting ? 1 : 0) + (hasMenu ? 1 : 0);

	const emptyMessage =
		typeof empty === "function" ? empty(q) : (empty ?? (q ? `No ${noun[1]} match that search.` : `There are no ${noun[1]} yet.`));
	const panel = (content: ReactNode) => (
		<TableRow className="hover:bg-transparent">
			<TableCell colSpan={span} className={cn(PANEL_HEIGHT, "text-center whitespace-normal text-muted-foreground")}>
				{content}
			</TableCell>
		</TableRow>
	);

	return (
		<>
			<Card className="gap-0 overflow-hidden py-0">
				<div className={cn("flex min-h-[53px] items-center gap-2 border-b bg-(--admin-toolbar) py-2 pr-4", !canSelect && "pl-4")}>
					{canSelect && (
						// Over the row-number column.
						<div className="flex w-[50px] shrink-0 justify-center">
							<Toggle variant="outline" size="sm" pressed={selecting} onPressedChange={toggleSelecting} aria-label={`Select ${noun[1]}`} className="bg-background px-2">
								<ListChecks />
							</Toggle>
						</div>
					)}
					{searchPlaceholder !== undefined && (
						<InputGroup className="max-w-sm bg-background dark:bg-background">
							<InputGroupAddon>
								<Search />
							</InputGroupAddon>
							<InputGroupInput placeholder={searchPlaceholder} value={searchText} onChange={(e) => onSearch(e.target.value)} />
						</InputGroup>
					)}
					{intro && <div className="min-w-0 text-sm text-muted-foreground">{intro}</div>}
					<div className="ml-auto flex shrink-0 items-center gap-3">
						{selecting &&
							allBulk.map((action) => (
								<Button
									key={action.label}
									variant="ghost"
									size="sm"
									className="hover:bg-foreground/10"
									disabled={selectedRows.length === 0 || busy}
									onClick={() => {
										const ids = selectedRows.map(keyOf);
										perform(() => action.run(ids, selectedRows), action.confirm?.(ids.length), action.destructive, action.icon);
									}}
								>
									{busy ? <Spinner /> : action.icon && <action.icon />}
									{action.label}
								</Button>
							))}
						{shown && total !== null && (
							<span className="text-sm text-muted-foreground">
								{selecting && selectedRows.length > 0 ? `${selectedRows.length} selected of ` : ""}
								{total} {total === 1 ? noun[0] : noun[1]}
							</span>
						)}
					</div>
				</div>
				<CardContent className="px-0">
					<Table className={cn("table-fixed", density === "compact" && COMPACT)}>
						<TableHeader className="bg-(--admin-table-head)">
							<TableRow>
								{ordinal && <TableHead className={`${ORDINAL} font-bold`}>#</TableHead>}
								{selecting && (
									<TableHead className={NARROW}>
										<Checkbox
											className={CHECKBOX}
											checked={allSelected ? true : selectedRows.length > 0 ? "indeterminate" : false}
											onCheckedChange={() => setSelected(allSelected ? new Set() : new Set(visible.map(keyOf)))}
											disabled={visible.length === 0}
											aria-label={`Select all ${noun[1]}`}
										/>
									</TableHead>
								)}
								{columns.map((c) => (
									<TableHead key={c.id} className={columnClass(c)} style={columnStyle(c)}>
										{c.sortable ? (
											<SortHeader field={c.sortKey ?? c.id} sort={sort} dir={dir} onSort={onSort}>
												{c.header}
											</SortHeader>
										) : (
											c.header
										)}
									</TableHead>
								))}
								{hasMenu && (
									<TableHead className={NARROW}>
										<span className="sr-only">Actions</span>
									</TableHead>
								)}
							</TableRow>
						</TableHeader>
						<TableBody aria-busy={loading} className={cn(shown && loading && "opacity-60 transition-opacity")}>
							{!shown
								? panel(
										failed && !loading ? (
											<div className="flex flex-col items-center gap-3">
												<span>The {noun[1]} could not be loaded.</span>
												<Button variant="outline" size="sm" onClick={reload}>
													<RotateCw />
													Try again
												</Button>
											</div>
										) : (
											<span className="inline-flex items-center gap-2">
												<Spinner className="size-5" />
												Loading...
											</span>
										),
									)
								: visible.length === 0
									? panel(emptyMessage)
									: visible.map((row, i) => {
											const id = keyOf(row);
											return (
												<TableRow
													key={id}
													className={cn(ROW, striped && STRIPE, (clickable || selecting) && "cursor-pointer")}
													data-state={selected.has(id) ? "selected" : undefined}
													onClick={clickable || selecting ? () => onRow(row) : undefined}
												>
													{ordinal && (
														<TableHead scope="row" className={`${ORDINAL} font-normal text-muted-foreground`}>
															{firstOrdinal + i}
														</TableHead>
													)}
													{selecting && (
														<TableCell className={NARROW} onClick={(e) => e.stopPropagation()}>
															<Checkbox className={CHECKBOX} checked={selected.has(id)} onCheckedChange={() => toggleRow(id)} aria-label={`Select ${noun[0]} ${firstOrdinal + i}`} />
														</TableCell>
													)}
													{columns.map((c) => (
														<TableCell
															key={c.id}
															className={cn(columnClass(c), !c.wrap && "truncate", c.wrap && "whitespace-normal", c.muted && "text-muted-foreground")}
															title={c.title?.(row) ?? undefined}
														>
															{c.cell ? c.cell(row) : defaultCell(row, c.id)}
														</TableCell>
													))}
													{hasMenu && (
														<TableCell className={NARROW} onClick={(e) => e.stopPropagation()}>
															<RowMenu row={row} actions={menuFor(row)} label={`Actions for ${noun[0]} ${firstOrdinal + i}`} onAction={perform} />
														</TableCell>
													)}
												</TableRow>
											);
										})}
						</TableBody>
					</Table>
				</CardContent>
				{pages > 1 && <PageBar page={page} pages={pages} onPage={onPage} />}
			</Card>
			<AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{pending?.confirm.title}</AlertDialogTitle>
						{pending?.confirm.description && <AlertDialogDescription>{pending.confirm.description}</AlertDialogDescription>}
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel className={ACTION_BUTTON}>
							<X />
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction variant={pending?.destructive ? "destructive" : "default"} onClick={() => pending && void pending.run()} className={ACTION_BUTTON}>
							{pending?.icon && <pending.icon />}
							{pending?.confirm.action ?? "Confirm"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

type Perform = (run: () => void | Promise<void>, confirm?: Confirmation, destructive?: boolean, icon?: LucideIcon) => void;

function RowMenu<T>({ row, actions, label, onAction }: { row: T; actions: RowAction<T>[]; label: string; onAction: Perform }) {
	if (actions.length === 0) return null;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="icon" className="size-8 text-muted-foreground/60 hover:text-muted-foreground" aria-label={label}>
					<EllipsisVertical />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				{actions.map((action) => (
					<DropdownMenuItem
						key={action.label}
						variant={action.destructive ? "destructive" : "default"}
						onSelect={() => onAction(() => action.onSelect(row), action.confirm, action.destructive, action.icon)}
					>
						{action.icon && <action.icon />}
						{action.label}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/** A row's property shown as text, "—" when empty. */
function defaultCell<T>(row: T, key: string): ReactNode {
	const value = (row as Record<string, unknown>)[key];
	return value === null || value === undefined || value === "" ? "—" : String(value);
}
