import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowDown, ArrowUp, ArrowUpDown, ListChecks, Plus, Search, Trash2, Users, X } from "lucide-react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Toggle } from "@/components/ui/toggle";
import { Spinner } from "@/components/ui/spinner";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import {
	Pagination,
	PaginationContent,
	PaginationItem,
	PaginationLink,
	PaginationNext,
	PaginationPrevious,
} from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { http, isHandledHttpError } from "@/lib/http";
import type { AdminUserList, UserSortField } from "../../../../shared/admin-users";
import { AdminPage } from "../../components/AdminPage";
import { ACTION_BUTTON } from "../../styles";
import { formatDate } from "./format";
import { RoleBadge, StatusBadge, UserAvatar } from "./user-ui";

const PAGE_SIZE = 20;
/** The row-number column: 40px wide, whatever the content. */
const ORDINAL = "w-[40px] min-w-[40px] max-w-[40px] px-0 text-center";

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

	const deleteSelected = async () => {
		setDeleting(true);
		let done = 0;
		try {
			// One at a time: the server's rules (yourself, the last admin) apply to each.
			for (const id of selected) {
				await http(`/api/admin/users/${id}`, { method: "DELETE" });
				done++;
			}
			toast.success(done === 1 ? "User deleted." : `${done} users deleted.`);
		} catch (error) {
			if (!isHandledHttpError(error)) toast.error("The users could not be deleted.");
		} finally {
			setDeleting(false);
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
				<div className="flex flex-wrap items-center justify-between gap-3 border-b bg-(--admin-toolbar) px-4 py-2">
					<InputGroup className="max-w-sm bg-background dark:bg-background">
						<InputGroupAddon>
							<Search />
						</InputGroupAddon>
						<InputGroupInput placeholder="Search by name or email" value={search} onChange={(e) => onSearch(e.target.value)} />
					</InputGroup>
					<div className="flex items-center gap-2">
						{data && (
							<span className="mr-2 text-sm text-muted-foreground">
								{selecting && selected.size > 0 ? `${selected.size} selected` : `${data.total} ${data.total === 1 ? "user" : "users"}`}
							</span>
						)}
						<Toggle variant="outline" size="sm" pressed={selecting} onPressedChange={toggleSelecting} aria-label="Select users" className="bg-background">
							<ListChecks />
							Select
						</Toggle>
						<AlertDialog>
							<AlertDialogTrigger asChild>
								<Button variant="destructive" size="sm" disabled={!selecting || selected.size === 0 || deleting}>
									{deleting ? <Spinner /> : <Trash2 />}
									Delete
								</Button>
							</AlertDialogTrigger>
							<AlertDialogContent>
								<AlertDialogHeader>
									<AlertDialogTitle>Delete {selected.size === 1 ? "this user" : `${selected.size} users`}?</AlertDialogTitle>
									<AlertDialogDescription>
										Their accounts and everything attached to them are removed, and they are signed out. This cannot be undone.
									</AlertDialogDescription>
								</AlertDialogHeader>
								<AlertDialogFooter>
									<AlertDialogCancel className={ACTION_BUTTON}>
										<X />
										Cancel
									</AlertDialogCancel>
									<AlertDialogAction variant="destructive" onClick={deleteSelected} className={ACTION_BUTTON}>
										<Trash2 />
										Delete
									</AlertDialogAction>
								</AlertDialogFooter>
							</AlertDialogContent>
						</AlertDialog>
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
						<Table>
							<TableHeader className="bg-(--admin-table-head)">
								<TableRow>
									<TableHead className={`${ORDINAL} font-bold`}>#</TableHead>
									{selecting && (
										<TableHead className="w-10">
											<Checkbox
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
									<TableHead>
										<SortHeader field="role" {...sortProps}>
											Role
										</SortHeader>
									</TableHead>
									<TableHead className="hidden sm:table-cell">Status</TableHead>
									<TableHead className="hidden pr-4 md:table-cell">
										<SortHeader field="createdAt" {...sortProps}>
											Created
										</SortHeader>
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
												<TableCell className={`${ORDINAL} text-muted-foreground`}>{(data.page - 1) * data.pageSize + i + 1}</TableCell>
												{selecting && (
													<TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
														<Checkbox
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
															{/* The link makes the row reachable from the keyboard too. */}
															<Link
																to={`/admin/users/${user.id}`}
																className="block truncate font-medium hover:underline"
																onClick={(e) => e.stopPropagation()}
															>
																{user.name || user.email}
															</Link>
															{user.name && <div className="truncate text-xs text-muted-foreground">{user.email}</div>}
														</div>
													</div>
												</TableCell>
												<TableCell>
													<RoleBadge role={user.role} />
												</TableCell>
												<TableCell className="hidden sm:table-cell">
													<StatusBadge active={user.emailVerified} />
												</TableCell>
												<TableCell className="hidden pr-4 text-muted-foreground md:table-cell">{formatDate(user.createdAt)}</TableCell>
											</TableRow>
										))
									: Array.from({ length: 5 }, (_, i) => (
											<TableRow key={i}>
												<TableCell className={ORDINAL}>
													<Skeleton className="mx-auto h-4 w-4" />
												</TableCell>
												{selecting && (
													<TableCell className="w-10">
														<Skeleton className="size-4" />
													</TableCell>
												)}
												<TableCell>
													<div className="flex items-center gap-3">
														<Skeleton className="size-8 rounded-full" />
														<Skeleton className="h-4 w-40" />
													</div>
												</TableCell>
												<TableCell>
													<Skeleton className="h-5 w-16" />
												</TableCell>
												<TableCell className="hidden sm:table-cell">
													<Skeleton className="h-5 w-16" />
												</TableCell>
												<TableCell className="hidden md:table-cell">
													<Skeleton className="h-4 w-24" />
												</TableCell>
											</TableRow>
										))}
							</TableBody>
						</Table>
					)}
				</CardContent>
				{pages > 1 && (
					<div className="flex items-center justify-between gap-4 border-t bg-(--admin-table-foot) px-4 py-2">
						<span className="text-sm text-muted-foreground">
							Page {page} of {pages}
						</span>
						<Pagination className="mx-0 w-auto">
							<PaginationContent>
								<PaginationItem>
									<PaginationPrevious
										href="#"
										aria-disabled={page <= 1}
										className={page <= 1 ? "pointer-events-none opacity-50" : ""}
										onClick={(e) => {
											e.preventDefault();
											update({ page: page > 2 ? String(page - 1) : null });
										}}
									/>
								</PaginationItem>
								{pageWindow(page, pages).map((n) => (
									<PaginationItem key={n} className="hidden sm:list-item">
										<PaginationLink
											href="#"
											isActive={n === page}
											onClick={(e) => {
												e.preventDefault();
												update({ page: n > 1 ? String(n) : null });
											}}
										>
											{n}
										</PaginationLink>
									</PaginationItem>
								))}
								<PaginationItem>
									<PaginationNext
										href="#"
										aria-disabled={page >= pages}
										className={page >= pages ? "pointer-events-none opacity-50" : ""}
										onClick={(e) => {
											e.preventDefault();
											update({ page: String(page + 1) });
										}}
									/>
								</PaginationItem>
							</PaginationContent>
						</Pagination>
					</div>
				)}
			</Card>
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

/** Up to five page numbers around the current one. */
function pageWindow(page: number, pages: number): number[] {
	const start = Math.max(1, Math.min(page - 2, pages - 4));
	return Array.from({ length: Math.min(5, pages) }, (_, i) => start + i);
}
