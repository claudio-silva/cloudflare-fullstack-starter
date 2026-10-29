import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowDown, ArrowUp, ArrowUpDown, EllipsisVertical, ListChecks, Plus, Search, Trash2, Users, X } from "lucide-react";
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Toggle } from "@/components/ui/toggle";
import { Spinner } from "@/components/ui/spinner";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { http, isHandledHttpError } from "@/lib/http";
import type { AdminUserList, UserSortField } from "../../../../shared/admin-users";
import { AdminPage } from "../../components/AdminPage";
import { PageBar } from "../../components/PageBar";
import { ACTION_BUTTON, ORDINAL } from "../../styles";
import { formatDate } from "./format";
import { RoleBadge, StatusBadge, UserAvatar } from "./user-ui";

const PAGE_SIZE = 20;
/** Darker than shadcn's default, so a checkbox shows against the shaded headings. */
const CHECKBOX = "border-neutral-500 dark:border-neutral-400";
/** The row menu's column. */
/** Fixed to the widest content each can hold: "Superadmin", "Disabled", a long date. */
const ROLE_COL = "w-[110px] min-w-[110px] whitespace-nowrap";
const STATUS_COL = "hidden w-[110px] min-w-[110px] whitespace-nowrap sm:table-cell";
const CREATED_COL = "hidden w-[90px] min-w-[90px] whitespace-nowrap md:table-cell";
/** As wide as the row-number column, with the box in the middle. */
const SELECT_COL = "w-[50px] min-w-[50px] max-w-[50px] px-0";
const MENU_COL = "w-[50px] min-w-[50px] max-w-[50px] px-0 text-center";

/**
 * The listing half of the CRUD example. Search, sort and page live in the URL,
 * so coming back from a user's page returns to the same list.
 */
export function UserList() {
	const navigate = useNavigate();
	const [params, setParams] = useSearchParams();
	const q = params.get("q") ?? "";
	const page = Math.max(1, Number(params.get("page")) || 1);
	const sort = (params.get("sort") as UserSortField) || "createdAt";
	const dir = params.get("dir") === "asc" ? "asc" : "desc";

	const [search, setSearch] = useState(q);
	const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
	const [data, setData] = useState<AdminUserList | null>(null);
	const [reloads, setReloads] = useState(0);
	const [selecting, setSelecting] = useState(false);
	const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
	const [deleting, setDeleting] = useState(false);
	/** The users the open confirmation would delete: the selection, or one row's user. */
	const [toDelete, setToDelete] = useState<string[] | null>(null);

	const update = (changes: Record<string, string | null>) =>
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

	// Search as the user types, once they pause.
	const onSearch = (value: string) => {
		setSearch(value);
		clearTimeout(searchTimer.current);
		searchTimer.current = setTimeout(() => update({ q: value.trim() || null, page: null }), 300);
	};

	useEffect(() => {
		let current = true;
		const query = new URLSearchParams({ q, page: String(page), pageSize: String(PAGE_SIZE), sort, dir });
		// A failed request is shown by the HTTP layer; the list stays as it was.
		http(`/api/admin/users?${query}`)
			.then((res) => res.json() as Promise<AdminUserList>)
			.then((list) => {
				if (!current) return;
				setData(list);
				setSelected(new Set());
			})
			.catch((error: unknown) => {
				if (!isHandledHttpError(error)) toast.error("The list could not be loaded.");
			});
		return () => {
			current = false;
		};
	}, [q, page, sort, dir, reloads]);

	const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
	const toggleSort = (field: UserSortField) =>
		update({ sort: field, dir: sort === field && dir === "asc" ? "desc" : "asc", page: null });

	const rows = data?.users ?? [];
	const allSelected = rows.length > 0 && rows.every((u) => selected.has(u.id));
	const toggleRow = (id: string) =>
		setSelected((prev) => {
			const next = new Set(prev);
			if (!next.delete(id)) next.add(id);
			return next;
		});
	const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((u) => u.id)));
	const toggleSelecting = (on: boolean) => {
		setSelecting(on);
		setSelected(new Set());
	};

	const deleteUsers = async (ids: string[]) => {
		setToDelete(null);
		setDeleting(true);
		let done = 0;
		try {
			// One at a time: the server's rules (yourself, the last admin) apply to each.
			for (const id of ids) {
				await http(`/api/admin/users/${id}`, { method: "DELETE" });
				done++;
			}
			toast.success(done === 1 ? "User deleted." : `${done} users deleted.`);
		} catch (error) {
			if (!isHandledHttpError(error)) toast.error("The users could not be deleted.");
		} finally {
			setDeleting(false);
			toggleSelecting(false);
			setReloads((n) => n + 1);
		}
	};

	const sortProps = { sort, dir, onSort: toggleSort } as const;

	return (
		<AdminPage
			title="Users"
			description="Everyone who can sign in to the app."
			actions={
				<Button asChild className={ACTION_BUTTON}>
					<Link to="/admin/users/new">
						<Plus />
						New user
					</Link>
				</Button>
			}
		>
			<Card className="gap-0 overflow-hidden py-0">
				<div className="flex items-center gap-2 border-b bg-(--admin-toolbar) py-2 pr-4">
					{/* Over the row-number column. */}
					<div className="flex w-[50px] shrink-0 justify-center">
						<Toggle variant="outline" size="sm" pressed={selecting} onPressedChange={toggleSelecting} aria-label="Select users" className="bg-background px-2">
							<ListChecks />
						</Toggle>
					</div>
					<InputGroup className="max-w-sm bg-background dark:bg-background">
						<InputGroupAddon>
							<Search />
						</InputGroupAddon>
						<InputGroupInput placeholder="Search by name or email" value={search} onChange={(e) => onSearch(e.target.value)} />
					</InputGroup>
					<div className="ml-auto flex items-center gap-3">
						{selecting && (
							<Button
								variant="ghost"
								size="sm"
								className="hover:bg-foreground/10"
								disabled={selected.size === 0 || deleting}
								onClick={() => setToDelete([...selected])}
							>
								{deleting ? <Spinner /> : <Trash2 />}
								Delete
							</Button>
						)}
						{data && (
							<span className="text-sm text-muted-foreground">
								{selecting && selected.size > 0 ? `${selected.size} selected of ` : ""}
								{data.total} {data.total === 1 ? "user" : "users"}
							</span>
						)}
					</div>
				</div>
				<CardContent className="px-0">
					{data && data.users.length === 0 ? (
						<Empty className="py-16">
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<Users />
								</EmptyMedia>
								<EmptyTitle>No users found</EmptyTitle>
								<EmptyDescription>{q ? "Nobody matches that search." : "There are no users yet."}</EmptyDescription>
							</EmptyHeader>
						</Empty>
					) : (
						<Table className="table-fixed">
							<TableHeader className="bg-(--admin-table-head)">
								<TableRow>
									<TableHead className={`${ORDINAL} font-bold`}>#</TableHead>
									{selecting && (
										<TableHead className={SELECT_COL}>
											<Checkbox
												className={`${CHECKBOX} mx-auto block`}
												checked={allSelected ? true : selected.size > 0 ? "indeterminate" : false}
												onCheckedChange={toggleAll}
												disabled={rows.length === 0}
												aria-label="Select all users"
											/>
										</TableHead>
									)}
									<TableHead>
										<SortHeader field="name" {...sortProps}>
											User
										</SortHeader>
									</TableHead>
									<TableHead className={ROLE_COL}>
										<SortHeader field="role" {...sortProps}>
											Role
										</SortHeader>
									</TableHead>
									<TableHead className={STATUS_COL}>
										<SortHeader field="status" {...sortProps}>
											Status
										</SortHeader>
									</TableHead>
									<TableHead className={CREATED_COL}>
										<SortHeader field="createdAt" {...sortProps}>
											Created
										</SortHeader>
									</TableHead>
									<TableHead className={MENU_COL}>
										<span className="sr-only">Actions</span>
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{data
									? data.users.map((user, i) => (
											<TableRow
												key={user.id}
												className="cursor-pointer"
												data-state={selected.has(user.id) ? "selected" : undefined}
												onClick={() => (selecting ? toggleRow(user.id) : navigate(`/admin/users/${user.id}`))}
											>
												<TableHead scope="row" className={`${ORDINAL} font-normal text-muted-foreground`}>{(data.page - 1) * data.pageSize + i + 1}</TableHead>
												{selecting && (
													<TableCell className={SELECT_COL} onClick={(e) => e.stopPropagation()}>
														<Checkbox
															className={`${CHECKBOX} mx-auto block`}
															checked={selected.has(user.id)}
															onCheckedChange={() => toggleRow(user.id)}
															aria-label={`Select ${user.name || user.email}`}
														/>
													</TableCell>
												)}
												<TableCell>
													<div className="flex items-center gap-3">
														<UserAvatar name={user.name} email={user.email} />
														<div className="min-w-0">
															<div className="truncate font-medium">{user.name || user.email}</div>
															{user.name && <div className="truncate text-xs text-muted-foreground">{user.email}</div>}
														</div>
													</div>
												</TableCell>
												<TableCell className={ROLE_COL}>
													<RoleBadge role={user.role} />
												</TableCell>
												<TableCell className={STATUS_COL}>
													<StatusBadge status={user.status} />
												</TableCell>
												<TableCell className={`${CREATED_COL} text-muted-foreground`}>{formatDate(user.createdAt)}</TableCell>
												<TableCell className={MENU_COL} onClick={(e) => e.stopPropagation()}>
													<DropdownMenu>
														<DropdownMenuTrigger asChild>
															<Button variant="ghost" size="icon" className="size-8 text-muted-foreground/60 hover:text-muted-foreground" aria-label={`Actions for ${user.name || user.email}`}>
																<EllipsisVertical />
															</Button>
														</DropdownMenuTrigger>
														<DropdownMenuContent align="end">
															<DropdownMenuItem variant="destructive" onSelect={() => setToDelete([user.id])}>
																<Trash2 />
																Delete
															</DropdownMenuItem>
														</DropdownMenuContent>
													</DropdownMenu>
												</TableCell>
											</TableRow>
										))
									: Array.from({ length: 5 }, (_, i) => (
											<TableRow key={i}>
												<TableHead scope="row" className={ORDINAL}>
													<Skeleton className="mx-auto h-4 w-4" />
												</TableHead>
												{selecting && (
													<TableCell className={SELECT_COL}>
														<Skeleton className="mx-auto size-4" />
													</TableCell>
												)}
												<TableCell>
													<div className="flex items-center gap-3">
														<Skeleton className="size-8 rounded-full" />
														<Skeleton className="h-4 w-40" />
													</div>
												</TableCell>
												<TableCell className={ROLE_COL}>
													<Skeleton className="h-5 w-16" />
												</TableCell>
												<TableCell className={STATUS_COL}>
													<Skeleton className="h-5 w-16" />
												</TableCell>
												<TableCell className={CREATED_COL}>
													<Skeleton className="h-4 w-24" />
												</TableCell>
												<TableCell className={MENU_COL} />
											</TableRow>
										))}
							</TableBody>
						</Table>
					)}
				</CardContent>
				{pages > 1 && <PageBar page={page} pages={pages} onPage={(n) => update({ page: n > 1 ? String(n) : null })} />}
			</Card>
			<AlertDialog open={toDelete !== null} onOpenChange={(open) => !open && setToDelete(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete {toDelete?.length === 1 ? "this user" : `${toDelete?.length ?? 0} users`}?</AlertDialogTitle>
						<AlertDialogDescription>
							Their accounts and everything attached to them are removed, and they are signed out. This cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel className={ACTION_BUTTON}>
							<X />
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction variant="destructive" onClick={() => toDelete && deleteUsers(toDelete)} className={ACTION_BUTTON}>
							<Trash2 />
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</AdminPage>
	);
}

type SortHeaderProps = { field: UserSortField; sort: UserSortField; dir: "asc" | "desc"; onSort: (field: UserSortField) => void; children: ReactNode };

function SortHeader({ field, sort, dir, onSort, children }: SortHeaderProps) {
	const Icon = sort !== field ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
	return (
		<Button variant="ghost" size="sm" className="-ml-3 h-8" onClick={() => onSort(field)}>
			{children}
			<Icon className={sort === field ? "" : "text-muted-foreground/60"} />
		</Button>
	);
}
