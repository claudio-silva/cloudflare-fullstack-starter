export const ROLE_LABELS: Record<string, string> = { user: "User", admin: "Admin", superadmin: "Superadmin" };

export const formatDate = (iso: string | null) =>
	iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";

export const formatDateTime = (iso: string | null) =>
	iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";

/** "Just now", "7 min", "2 h 5 min", "3 d" */
export function formatIdle(seconds: number | null): string {
	if (seconds === null) return "—";
	const minutes = Math.floor(seconds / 60);
	if (minutes < 1) return "Just now";
	if (minutes < 60) return `${minutes} min`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
	return `${Math.floor(hours / 24)} d`;
}
