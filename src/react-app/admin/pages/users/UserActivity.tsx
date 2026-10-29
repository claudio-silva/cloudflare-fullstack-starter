import { useEffect, useState } from "react";
import { toast } from "sonner";
import { LogIn, LogOut, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { http, isHandledHttpError } from "@/lib/http";
import type { ActivityEvent, AdminUserActivity } from "../../../../shared/admin-users";
import { formatDateTime } from "./format";

const KINDS = {
	"sign-in": { label: "Sign-in", icon: LogIn, variant: "outline" },
	"sign-out": { label: "Sign-out", icon: LogOut, variant: "outline" },
	failed: { label: "Failed sign-in", icon: ShieldAlert, variant: "destructive" },
} as const;

/** The user's sign-ins, failed attempts and sign-outs, newest first (`login_events`). */
export function UserActivity({ userId }: { userId: string }) {
	const [activity, setActivity] = useState<AdminUserActivity | null>(null);

	useEffect(() => {
		let current = true;
		http(`/api/admin/users/${userId}/activity`)
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
	}, [userId]);

	return (
		<Card>
			<CardHeader>
				<CardTitle>Activity</CardTitle>
				<CardDescription>
					{activity ? `The last ${activity.limit} sign-ins, failed attempts and sign-outs.` : "Sign-ins, failed attempts and sign-outs."} Older
					entries are removed after the retention period.
				</CardDescription>
			</CardHeader>
			<CardContent className="px-0">
				<Table>
					<TableHeader className="bg-(--admin-table-head)">
						<TableRow>
							<TableHead className="pl-6">When</TableHead>
							<TableHead>Event</TableHead>
							<TableHead>IP address</TableHead>
							<TableHead>Country</TableHead>
							<TableHead className="pr-6">Browser</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{activity ? (
							activity.events.length === 0 ? (
								<TableRow>
									<TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
										No activity recorded yet.
									</TableCell>
								</TableRow>
							) : (
								activity.events.map((event) => <EventRow key={event.id} event={event} />)
							)
						) : (
							Array.from({ length: 4 }, (_, i) => (
								<TableRow key={i}>
									<TableCell colSpan={5}>
										<Skeleton className="h-5 w-full" />
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</CardContent>
		</Card>
	);
}

function EventRow({ event }: { event: ActivityEvent }) {
	const { label, icon: Icon, variant } = KINDS[event.kind];
	return (
		<TableRow>
			<TableCell className="pl-6 whitespace-nowrap">{formatDateTime(event.createdAt)}</TableCell>
			<TableCell>
				<Badge variant={variant} className="gap-1.5">
					<Icon />
					{label}
				</Badge>
			</TableCell>
			<TableCell className="whitespace-nowrap">{event.ip ?? "—"}</TableCell>
			<TableCell>{event.country ?? "—"}</TableCell>
			<TableCell className="max-w-64 truncate pr-6 text-muted-foreground" title={event.userAgent ?? undefined}>
				{event.userAgent ?? "—"}
			</TableCell>
		</TableRow>
	);
}
