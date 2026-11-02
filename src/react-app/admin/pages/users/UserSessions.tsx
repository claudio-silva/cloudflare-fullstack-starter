import { LogOut } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { countryName } from "@/lib/admin-util";
import { http } from "@/lib/http";
import type { UserSession } from "../../../../shared/sessions";
import { AdminTable, type AdminColumn } from "../../components/AdminTable";
import { formatDateTime, formatIdle } from "./format";
import { StatusBadge } from "./user-ui";

const COLUMNS: AdminColumn<UserSession>[] = [
	{
		id: "device",
		header: "Device",
		sortable: true,
		title: (session) => session.userAgent,
		cell: (session) => (
			<div className="flex min-w-0 items-center gap-2">
				<span className="truncate">{session.device}</span>
				{session.current && <Badge variant="secondary">Your session</Badge>}
			</div>
		),
	},
	{ id: "ip", header: "IP address", sortable: true, width: 140, cell: (session) => session.ip || "—" },
	{
		id: "country",
		header: "Country",
		sortable: true,
		width: 140,
		hideBelow: "md",
		title: (session) => session.country,
		cell: (session) => countryName(session.country),
		sortValue: (session) => (session.country ? countryName(session.country) : null),
	},
	{ id: "createdAt", header: "Signed in", sortable: true, width: 170, hideBelow: "lg", muted: true, cell: (session) => formatDateTime(session.createdAt) },
	{ id: "lastSeenAt", header: "Last seen", sortable: true, width: 110, muted: true, cell: (session) => formatIdle(session.idleSeconds) },
	{ id: "status", header: "Status", sortable: true, width: 110, cell: (session) => <StatusBadge status={session.status} /> },
];

/**
 * The user's live sessions, one per device (`GET /api/admin/users/:id/sessions`),
 * a handful at most, so they load whole and the table works on them in the
 * browser. Each row can be ended on its own; the page learns of it through
 * `onChange` (to refresh the user's status, idle time and counts).
 */
export function UserSessions({ userId, isMe, reloadKey, onChange }: { userId: string; isMe: boolean; reloadKey?: unknown; onChange: () => void }) {
	return (
		<AdminTable<UserSession>
			url={`/api/admin/users/${userId}/sessions`}
			fullData
			columns={COLUMNS}
			state="local"
			pageSize={10}
			noun={["session", "sessions"]}
			reloadKey={reloadKey}
			intro="Where the user is signed in now, one row per device. Ending a session signs that device out; the user can sign in again."
			empty="Not signed in anywhere."
			rowActions={(session) => [
				{
					label: "Sign out this device",
					icon: LogOut,
					destructive: true,
					confirm: {
						title: `Sign ${session.device} out?`,
						description:
							isMe && session.current
								? "This is the session you are using: you will have to sign in again."
								: "That device is signed out and the user has to sign in again. It is logged as revoked, by you.",
						action: "Sign out",
					},
					onSelect: async (row) => {
						try {
							await http(`/api/admin/users/${userId}/sessions/${encodeURIComponent(row.id)}/sign-out`, { method: "POST" });
							toast.success("Session ended.");
						} finally {
							onChange();
						}
					},
				},
			]}
		/>
	);
}
