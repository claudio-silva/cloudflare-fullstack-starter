export const ROLE_LABELS: Record<string, string> = { user: "User", admin: "Admin", superadmin: "Superadmin" };

export const formatDate = (iso: string | null) =>
	iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";

export const formatDateTime = (iso: string | null) =>
	iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
