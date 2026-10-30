import { Ban, Clock, LogIn, LogOut, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getLocale } from "@/lib/i18n";
import { countryName } from "@/lib/admin-util";
import { describeBrowser, type ActivityEvent, type AdminUserActivity } from "../../../../shared/admin-users";
import { AdminTable, type AdminColumn } from "../../components/AdminTable";
import { formatDateTime, formatDuration, methodLabel } from "./format";

const KINDS = {
	"sign-in": { label: "Sign-in", icon: LogIn, variant: "outline" },
	"sign-out": { label: "Sign-out", icon: LogOut, variant: "outline" },
	"session-expired": { label: "Session expired", icon: Clock, variant: "outline" },
	"session-revoked": { label: "Session revoked", icon: Ban, variant: "outline" },
	failed: { label: "Failed sign-in", icon: ShieldAlert, variant: "destructive" },
} as const;

const COLUMNS: AdminColumn<ActivityEvent>[] = [
	{ id: "createdAt", header: "When", sortable: true, width: 170, cell: (event) => formatDateTime(event.createdAt) },
	{ id: "kind", header: "Event", sortable: true, width: 250, cell: (event) => <EventCell event={event} /> },
	{ id: "ip", header: "IP address", sortable: true, width: 140, cell: (event) => event.ip || "—" },
	{ id: "country", header: "Country", sortable: true, width: 130, title: (event) => event.country, cell: (event) => countryName(event.country) },
	{ id: "browser", header: "Browser", sortable: true, muted: true, title: (event) => event.userAgent, cell: (event) => describeBrowser(event.userAgent) },
];

/** The user's sign-ins, failed attempts, sign-outs and ended sessions, newest first (`login_events`). */
export function UserActivity({ userId }: { userId: string }) {
	return (
		<AdminTable<ActivityEvent, AdminUserActivity>
			url={`/api/admin/users/${userId}/activity`}
			// Country names sort in the language the page shows them in.
			params={{ locale: getLocale() }}
			rows={(data) => data.events}
			columns={COLUMNS}
			pageSize={10}
			state="local"
			noun={["event", "events"]}
			intro="Sign-ins, failed attempts, sign-outs and sessions that expired or were revoked. Kept permanently unless a retention period is set."
			empty="No activity recorded yet."
		/>
	);
}

function EventCell({ event }: { event: ActivityEvent }) {
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
		<div className="flex min-w-0 items-center gap-2">
			<Badge variant={variant} className="shrink-0 gap-1.5">
				<Icon />
				{label}
			</Badge>
			<span className="truncate text-xs text-muted-foreground" title={detail}>
				{detail}
			</span>
		</div>
	);
}
