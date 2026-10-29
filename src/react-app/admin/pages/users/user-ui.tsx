import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { UserStatus } from "../../../../shared/admin-users";
import { ROLE_LABELS } from "./format";

export function RoleBadge({ role }: { role: string }) {
	const variant = role === "superadmin" ? "default" : role === "admin" ? "secondary" : "outline";
	return <Badge variant={variant}>{ROLE_LABELS[role] ?? role}</Badge>;
}

const STATUS: Record<Exclude<UserStatus, "offline">, { label: string; dot: string }> = {
	active: { label: "Active", dot: "bg-emerald-500" },
	idle: { label: "Idle", dot: "bg-neutral-400" },
	disabled: { label: "Disabled", dot: "bg-red-500" },
};

/** A user with no session gets a bare dash, not a pill. */
export function StatusBadge({ status }: { status: UserStatus }) {
	if (status === "offline") return <span className="text-muted-foreground" aria-label="Signed out">—</span>;
	const { label, dot } = STATUS[status];
	return (
		<Badge variant="outline" className="gap-1.5">
			<span className={cn("size-1.5 rounded-full", dot)} />
			{label}
		</Badge>
	);
}

export function UserAvatar({ name, email, className }: { name: string | null; email: string; className?: string }) {
	const initials = (name || email)
		.split(/\s+/)
		.map((part) => part[0])
		.join("")
		.slice(0, 2)
		.toUpperCase();
	return (
		<Avatar className={cn("size-8", className)}>
			<AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">{initials}</AvatarFallback>
		</Avatar>
	);
}
