import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Ban, Clock, LogIn, LogOut, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { http, isHandledHttpError } from "@/lib/http";
import { describeBrowser, type ActivityEvent, type ActivitySortField, type AdminUserActivity } from "../../../../shared/admin-users";
import { SortHeader } from "../../components/SortHeader";
import { nextSort, type SortDir } from "../../sort";
import { getLocale } from "@/lib/i18n";
import { countryName } from "@/lib/countries";
import { PageBar } from "../../components/PageBar";
import { ORDINAL } from "../../styles";
import { formatDateTime, formatDuration, methodLabel } from "./format";

const PAGE_SIZE = 10;

const KINDS = {
	"sign-in": { label: "Sign-in", icon: LogIn, variant: "outline" },
	"sign-out": { label: "Sign-out", icon: LogOut, variant: "outline" },
	"session-expired": { label: "Session expired", icon: Clock, variant: "outline" },
	"session-revoked": { label: "Session revoked", icon: Ban, variant: "outline" },
	failed: { label: "Failed sign-in", icon: ShieldAlert, variant: "destructive" },
} as const;

/** The user's sign-ins, failed attempts, sign-outs and ended sessions, newest first (`login_events`), laid out like the user list. */
export function UserActivity({ userId }: { userId: string }) {
	const [page, setPage] = useState(1);
	const [order, setOrder] = useState<{ sort: ActivitySortField | null; dir: SortDir }>({ sort: null, dir: "asc" });
	const [activity, setActivity] = useState<AdminUserActivity | null>(null);

	useEffect(() => {
		let current = true;
		http(`/api/admin/users/${userId}/activity?page=${page}&pageSize=${PAGE_SIZE}${order.sort ? `&sort=${order.sort}&dir=${order.dir}&locale=${encodeURIComponent(getLocale())}` : ""}`)
			.then(async (res) => (await res.json()) as AdminUserActivity)
			.then((data) => {
				if (current) setActivity(data);
			})
			.catch((error: unknown) => {
				if (!isHandledHttpError(error)) toast.error("The activity could not be loaded.");
			});
		return () => {
			current = false;
		};
	}, [userId, page, order]);

	const toggleSort = (field: ActivitySortField) => {
		setOrder(nextSort(order, field));
		setPage(1);
	};
	const sortProps = { sort: order.sort, dir: order.dir, onSort: toggleSort } as const;
	const pages = activity ? Math.max(1, Math.ceil(activity.total / activity.pageSize)) : 1;

	return (
		<Card className="gap-0 overflow-hidden py-0">
			<div className="flex items-center justify-between gap-4 border-b bg-(--admin-toolbar) px-4 py-3">
				<span className="text-sm text-muted-foreground">Sign-ins, failed attempts, sign-outs and sessions that expired or were revoked. Older entries are removed after the retention period.</span>
				{activity && (
					<span className="shrink-0 text-sm text-muted-foreground">
						{activity.total} {activity.total === 1 ? "event" : "events"}
					</span>
				)}
			</div>
			<CardContent className="px-0">
				<Table className="table-fixed">
					<TableHeader className="bg-(--admin-table-head)">
						<TableRow>
							<TableHead className={`${ORDINAL} font-bold`}>#</TableHead>
							<TableHead className="w-[170px]">
								<SortHeader field="createdAt" {...sortProps}>
									When
								</SortHeader>
							</TableHead>
							<TableHead className="w-[250px]">
								<SortHeader field="kind" {...sortProps}>
									Event
								</SortHeader>
							</TableHead>
							<TableHead className="w-[140px]">
								<SortHeader field="ip" {...sortProps}>
									IP address
								</SortHeader>
							</TableHead>
							<TableHead className="w-[130px]">
								<SortHeader field="country" {...sortProps}>
									Country
								</SortHeader>
							</TableHead>
							<TableHead>
								<SortHeader field="browser" {...sortProps}>
									Browser
								</SortHeader>
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{activity ? (
							activity.events.length === 0 ? (
								<TableRow>
									<TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
										No activity recorded yet.
									</TableCell>
								</TableRow>
							) : (
								activity.events.map((event, i) => <EventRow key={event.id} event={event} ordinal={(activity.page - 1) * activity.pageSize + i + 1} />)
							)
						) : (
							Array.from({ length: 4 }, (_, i) => (
								<TableRow key={i}>
									<TableHead scope="row" className={ORDINAL}>
										<Skeleton className="mx-auto h-4 w-4" />
									</TableHead>
									<TableCell colSpan={5}>
										<Skeleton className="h-5 w-full" />
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</CardContent>
			<PageBar page={page} pages={pages} onPage={setPage} />
		</Card>
	);
}

function EventRow({ event, ordinal }: { event: ActivityEvent; ordinal: number }) {
	const { label, icon: Icon, variant } = KINDS[event.kind];
	// How a sign-in authenticated; how long a session lasted, and who ended it if not the user.
	const detail = [
		event.method && methodLabel(event.method),
		event.durationSeconds !== null && formatDuration(Math.max(1, event.durationSeconds)),
		event.kind === "session-revoked" && event.actor && `by ${event.actor}`,
	]
		.filter(Boolean)
		.join(" · ");
	return (
		<TableRow>
			<TableHead scope="row" className={`${ORDINAL} font-normal text-muted-foreground`}>
				{ordinal}
			</TableHead>
			<TableCell className="whitespace-nowrap">{formatDateTime(event.createdAt)}</TableCell>
			<TableCell>
				<div className="flex min-w-0 items-center gap-2">
					<Badge variant={variant} className="shrink-0 gap-1.5">
						<Icon />
						{label}
					</Badge>
					<span className="truncate text-xs text-muted-foreground" title={detail}>
						{detail}
					</span>
				</div>
			</TableCell>
			<TableCell className="truncate">{event.ip || "—"}</TableCell>
			<TableCell className="truncate" title={event.country ?? undefined}>
				{countryName(event.country)}
			</TableCell>
			<TableCell className="truncate text-muted-foreground" title={event.userAgent ?? undefined}>
				{describeBrowser(event.userAgent)}
			</TableCell>
		</TableRow>
	);
}
