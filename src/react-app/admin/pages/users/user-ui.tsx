import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ROLE_LABELS } from "./format";

export function RoleBadge({ role }: { role: string }) {
	const variant = role === "superadmin" ? "default" : role === "admin" ? "secondary" : "outline";
	return <Badge variant={variant}>{ROLE_LABELS[role] ?? role}</Badge>;
}

export function StatusBadge({ active }: { active: boolean }) {
	return (
		<Badge variant="outline" className="gap-1.5">
			<span className={cn("size-1.5 rounded-full", active ? "bg-emerald-500" : "bg-muted-foreground/50")} />
			{active ? "Active" : "Inactive"}
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
