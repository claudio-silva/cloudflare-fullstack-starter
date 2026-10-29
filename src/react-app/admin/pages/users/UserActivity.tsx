import { useEffect, useState } from "react";
import { toast } from "sonner";
import { LogIn, LogOut, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { http, isHandledHttpError } from "@/lib/http";
import { describeBrowser, type ActivityEvent, type AdminUserActivity } from "../../../../shared/admin-users";
import { PageBar } from "../../components/PageBar";
import { ORDINAL } from "../../styles";
import { formatDateTime } from "./format";

const PAGE_SIZE = 10;

const KINDS = {
	"sign-in": { label: "Sign-in", icon: LogIn, variant: "outline" },
	"sign-out": { label: "Sign-out", icon: LogOut, variant: "outline" },
	failed: { label: "Failed sign-in", icon: ShieldAlert, variant: "destructive" },
} as const;

/** The user's sign-ins, failed attempts and sign-outs, newest first (`login_events`), laid out like the user list. */
export function UserActivity({ userId }: { userId: string }) {
	const [page, setPage] = useState(1);
	const [activity, setActivity] = useState<AdminUserActivity | null>(null);

	useEffect(() => {
		let current = true;
		http(`/api/admin/users/${userId}/activity?page=${page}&pageSize=${PAGE_SIZE}`)
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
	}, [userId, page]);

	const pages = activity ? Math.max(1, Math.ceil(activity.total / activity.pageSize)) : 1;

	return (
		<Card className="gap-0 overflow-hidden py-0">
			<div className="flex items-center justify-between gap-4 border-b bg-(--admin-toolbar) px-4 py-3">
				<span className="text-sm text-muted-foreground">Sign-ins, failed attempts and sign-outs. Older entries are removed after the retention period.</span>
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
							<TableHead className="w-[170px]">When</TableHead>
							<TableHead className="w-[160px]">Event</TableHead>
							<TableHead className="w-[140px]">IP address</TableHead>
							<TableHead className="w-[80px]">Country</TableHead>
							<TableHead>Browser</TableHead>
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
	return (
		<TableRow>
			<TableHead scope="row" className={`${ORDINAL} font-normal text-muted-foreground`}>
				{ordinal}
			</TableHead>
			<TableCell className="whitespace-nowrap">{formatDateTime(event.createdAt)}</TableCell>
			<TableCell>
				<Badge variant={variant} className="gap-1.5">
					<Icon />
					{label}
				</Badge>
			</TableCell>
			<TableCell className="truncate">{event.ip ?? "—"}</TableCell>
			<TableCell>{event.country ?? "—"}</TableCell>
			<TableCell className="truncate text-muted-foreground" title={event.userAgent ?? undefined}>
				{describeBrowser(event.userAgent)}
			</TableCell>
		</TableRow>
	);
}
