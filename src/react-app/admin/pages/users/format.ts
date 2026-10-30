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

/** Time in session: "—" for none, "< 1 min", "45 min", "3 h 12 min", "2 d 4 h". */
export function formatDuration(seconds: number | null): string {
	if (!seconds) return "—";
	const minutes = Math.floor(seconds / 60);
	if (minutes < 1) return "< 1 min";
	if (minutes < 60) return `${minutes} min`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
	const days = Math.floor(hours / 24);
	return hours % 24 ? `${days} d ${hours % 24} h` : `${days} d`;
}

/** Better Auth provider ids as people say them. */
export function methodLabel(providerId: string): string {
	if (providerId === "credential" || providerId === "password") return "Password";
	if (providerId === "email-link") return "Email link";
	return providerId.charAt(0).toUpperCase() + providerId.slice(1);
}
