import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AdminUser, AdminUserList } from "../../../../shared/admin-users";
import { AdminPage } from "../../components/AdminPage";
import { AdminTable, type AdminColumn } from "../../components/AdminTable";
import { ACTION_BUTTON } from "../../styles";
import { formatDate, formatDateTime, formatDuration, formatIdle } from "./format";
import { RoleBadge, StatusBadge, UserAvatar } from "./user-ui";

/** Widths fit the widest content each can hold: "Superadmin", "Disabled", a long date. */
const COLUMNS: AdminColumn<AdminUser>[] = [
	{
		id: "name",
		header: "User",
		sortable: true,
		cell: (user) => (
			<div className="flex items-center gap-3">
				<UserAvatar name={user.name} email={user.email} image={user.image} />
				<div className="min-w-0">
					<div className="truncate font-medium">{user.name || user.email}</div>
					{user.name && <div className="truncate text-xs text-muted-foreground">{user.email}</div>}
				</div>
			</div>
		),
	},
	{ id: "role", header: "Role", sortable: true, width: 110, cell: (user) => <RoleBadge role={user.role} /> },
	{ id: "status", header: "Status", sortable: true, width: 110, hideBelow: "sm", cell: (user) => <StatusBadge status={user.status} /> },
	{ id: "lastSignInAt", header: "Last sign-in", sortable: true, width: 180, hideBelow: "lg", muted: true, cell: (user) => formatDateTime(user.lastSignInAt) },
	{ id: "idleSeconds", header: "Idle", sortable: true, width: 100, hideBelow: "lg", muted: true, cell: (user) => formatIdle(user.idleSeconds) },
	{ id: "usageSeconds", header: "Usage", sortable: true, width: 110, hideBelow: "xl", muted: true, cell: (user) => formatDuration(user.usageSeconds) },
	{ id: "createdAt", header: "Created", sortable: true, width: 120, hideBelow: "md", muted: true, cell: (user) => formatDate(user.createdAt) },
];

/**
 * The listing half of the CRUD example. Search, sort and page live in the URL,
 * so coming back from a user's page returns to the same list.
 */
export function UserList() {
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
			<AdminTable<AdminUser, AdminUserList>
				url="/api/admin/users"
				rows={(data) => data.users}
				columns={COLUMNS}
				noun={["user", "users"]}
				search="Search by name or email"
				rowHref={(user) => `/admin/users/${user.id}`}
				deletable={{
					url: (id) => `/api/admin/users/${id}`,
					description: "Their accounts and everything attached to them are removed, and they are signed out. This cannot be undone.",
				}}
			/>
		</AdminPage>
	);
}
