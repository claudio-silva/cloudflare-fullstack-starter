import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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
import { nextSort, type SortDir } from "../sort";
import { ACTION_BUTTON, ORDINAL } from "../styles";
import { PageBar } from "./PageBar";
import { SortHeader } from "./SortHeader";

/**
 * The admin area's table: a server-backed list with the toolbar, row numbers,
 * sortable headings, selection, row menus, bulk actions, pages and the
 * loading and empty states every list here shares. docs/ADMIN_TABLE.md has the
 * guide; the props below are the reference.
 *
 * The endpoint answers `GET <url>?page=&pageSize=[&q=][&sort=&dir=]` with
 * `{ total, page, pageSize, items }` (the rows' key can be another: `rows`).
 */

/** What every list endpoint returns besides its rows. */
export type ListPage = { total: number; page: number; pageSize: number };

export type AdminColumn<T> = {
	/** Unique in the table. The sort key sent to the server, unless `sortKey` says otherwise. */
	id: string;
	header: ReactNode;
	/** The cell's content. Defaults to the row's property named `id`, or "—" when empty. */
	cell?: (row: T) => ReactNode;
	/** Sorts on the server: the heading cycles ascending, descending, none. */
	sortable?: boolean;
	sortKey?: string;
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

export type AdminTableProps<T, D extends ListPage = ListPage & { items: T[] }> = {
	/** The list endpoint. */
	url: string;
	/** Sent with every request, e.g. a filter or the locale. */
	params?: Record<string, string | undefined>;
	/** Takes the rows out of the response. Defaults to its `items`. */
	rows?: (data: D) => T[];
	/** Identifies a row. Defaults to its `id`. */
	rowKey?: (row: T) => string;
	columns: AdminColumn<T>[];
	/** Rows per page. Default 20. */
	pageSize?: number;
	/**
	 * Where search, sort and page are kept. `"url"` (default): in the address,
	 * so returning to the page brings the list back as it was. `"local"`: in the
	 * component, for a table that is part of another page (a tab, a panel).
	 */
	state?: "url" | "local";
	/** What a row is, for the count and the messages: `["user", "users"]`. Default `["record", "records"]`. */
	noun?: [singular: string, plural: string];
	/** A search box with this placeholder; the server gets the text as `q`. */
	search?: string;
	/** Text or markup in the toolbar, e.g. what the list contains. Shown beside the search box, or in its place. */
	intro?: ReactNode;
	/** The `#` column. Default true. */
	ordinal?: boolean;
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
/** The loading, empty and failed states: a panel of one height, with the message in the middle. */
const PANEL_HEIGHT = "h-64";

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Search, sort and page, in the URL or in the component. */
function useListState(mode: "url" | "local") {
	const [params, setParams] = useSearchParams();
	const [local, setLocal] = useState<Record<string, string>>({});
	const read = (key: string) => (mode === "url" ? params.get(key) : local[key]) ?? null;
	const update = (changes: Record<string, string | null>) => {
		if (mode === "local") {
			setLocal((prev) => {
				const next = { ...prev };
				for (const [key, value] of Object.entries(changes)) {
					if (value) next[key] = value;
					else delete next[key];
				}
				return next;
			});
			return;
		}
		setParams(
			(prev) => {
				const next = new URLSearchParams(prev);
				for (const [key, value] of Object.entries(changes)) {
					if (value) next.set(key, value);
					else next.delete(key);
				}
				return next;
			},
			{ replace: true },
		);
	};
	return { read, update };
}

export function AdminTable<T, D extends ListPage = ListPage & { items: T[] }>(props: AdminTableProps<T, D>) {
	const {
		url,
		params,
		columns,
		pageSize = 20,
		state = "url",
		noun = ["record", "records"],
		search: searchPlaceholder,
		intro,
		ordinal = true,
		rowHref,
		onRowClick,
		rowActions,
		deletable,
		bulkActions = [],
		empty,
		reloadKey,
	} = props;
	const rowsOf = props.rows ?? ((data: D) => (data as unknown as { items: T[] }).items);
	const keyOf = props.rowKey ?? ((row: T) => String((row as { id: unknown }).id));
	const navigate = useNavigate();

	const list = useListState(state);
	const q = list.read("q") ?? "";
	const page = Math.max(1, Number(list.read("page")) || 1);
	const sortable = columns.filter((c) => c.sortable).map((c) => c.sortKey ?? c.id);
	const sortParam = list.read("sort");
	const sort = sortable.find((s) => s === sortParam) ?? null;
	const dir: SortDir = list.read("dir") === "asc" ? "asc" : "desc";

	const [searchText, setSearchText] = useState(q);
	const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
	const [data, setData] = useState<D | null>(null);
	const [failed, setFailed] = useState(false);
	const [reloads, setReloads] = useState(0);
	const [selecting, setSelecting] = useState(false);
	const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
	const [busy, setBusy] = useState(false);
	/** The open confirmation, and what it runs once confirmed. */
	const [pending, setPending] = useState<{ confirm: Confirmation; destructive?: boolean; icon?: LucideIcon; run: () => Promise<void> } | null>(null);

	const paramsKey = JSON.stringify(params ?? {});
	const plural = noun[1];
	/** The request the current inputs make; the list is loading until the answer to it is in. */
	const requestKey = JSON.stringify([url, paramsKey, page, pageSize, q, sort, dir, reloads, String(reloadKey)]);
	const [settledKey, setSettledKey] = useState<string | null>(null);
	const loading = settledKey !== requestKey;
	useEffect(() => {
		let current = true;
		const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
		if (q) query.set("q", q);
		if (sort) {
			query.set("sort", sort);
			query.set("dir", dir);
		}
		for (const [key, value] of Object.entries(JSON.parse(paramsKey) as Record<string, string | undefined>)) {
			if (value !== undefined) query.set(key, value);
		}
		// A failure is shown by the HTTP layer; the list keeps what it had.
		http(`${url}${url.includes("?") ? "&" : "?"}${query}`)
			.then((res) => res.json() as Promise<D>)
			.then((next) => {
				if (!current) return;
				setData(next);
				setFailed(false);
				setSelected(new Set());
			})
			.catch((error: unknown) => {
				if (!current) return;
				setFailed(true);
				if (!isHandledHttpError(error)) toast.error(`The ${plural} could not be loaded.`);
			})
			.finally(() => current && setSettledKey(requestKey));
		return () => {
			current = false;
		};
	}, [url, paramsKey, page, pageSize, q, sort, dir, plural, requestKey]);

	const reload = () => setReloads((n) => n + 1);
	const rows = data ? rowsOf(data) : [];
	const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
	const firstOrdinal = data ? (data.page - 1) * data.pageSize + 1 : 1;

	const onSearch = (value: string) => {
		setSearchText(value);
		clearTimeout(searchTimer.current);
		// Search as the user types, once they pause.
		searchTimer.current = setTimeout(() => list.update({ q: value.trim() || null, page: null }), 300);
	};
	const onSort = (field: string) => {
		const next = nextSort({ sort, dir }, field);
		list.update({ sort: next.sort, dir: next.sort ? next.dir : null, page: null });
	};
	const onPage = (n: number) => list.update({ page: n > 1 ? String(n) : null });

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

	const allSelected = rows.length > 0 && rows.every((r) => selected.has(keyOf(r)));
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
									disabled={selected.size === 0 || busy}
									onClick={() => {
										const ids = [...selected];
										const chosen = rows.filter((r) => selected.has(keyOf(r)));
										perform(() => action.run(ids, chosen), action.confirm?.(ids.length), action.destructive, action.icon);
									}}
								>
									{busy ? <Spinner /> : action.icon && <action.icon />}
									{action.label}
								</Button>
							))}
						{data && (
							<span className="text-sm text-muted-foreground">
								{selecting && selected.size > 0 ? `${selected.size} selected of ` : ""}
								{data.total} {data.total === 1 ? noun[0] : noun[1]}
							</span>
						)}
					</div>
				</div>
				<CardContent className="px-0">
					<Table className="table-fixed">
						<TableHeader className="bg-(--admin-table-head)">
							<TableRow>
								{ordinal && <TableHead className={`${ORDINAL} font-bold`}>#</TableHead>}
								{selecting && (
									<TableHead className={NARROW}>
										<Checkbox
											className={CHECKBOX}
											checked={allSelected ? true : selected.size > 0 ? "indeterminate" : false}
											onCheckedChange={() => setSelected(allSelected ? new Set() : new Set(rows.map(keyOf)))}
											disabled={rows.length === 0}
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
						<TableBody aria-busy={loading} className={cn(data && loading && "opacity-60 transition-opacity")}>
							{!data
								? panel(
										failed ? (
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
								: rows.length === 0
									? panel(emptyMessage)
									: rows.map((row, i) => {
											const id = keyOf(row);
											return (
												<TableRow
													key={id}
													className={cn((clickable || selecting) && "cursor-pointer")}
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
