import { format } from "date-fns";
import { describeBrowser } from "../../shared/browser";
import type { CliActivityEvent, CliUserDetails, CliUserSummary } from "./db";

type TableRow = Record<string, unknown>;

type Timestamp = number | string | Date | null;

type UserRow = Record<string, string>;

export function printTable(data: TableRow[], columns: string[]): void {
	if (!data || data.length === 0) {
		console.log("No data to display");
		return;
	}

	const colWidths: Record<string, number> = {};
	columns.forEach((col) => {
		colWidths[col] = Math.max(col.length, ...data.map((row) => String(row[col] ?? "").length));
	});

	const headerRow = columns.map((col) => col.padEnd(colWidths[col])).join(" | ");
	console.log(headerRow);
	console.log("-".repeat(headerRow.length));

	data.forEach((row) => {
		const dataRow = columns
			.map((col) => {
				let value = row[col];
				if (value instanceof Date) value = format(value, "yyyy-MM-dd HH:mm:ss");
				else if (typeof value === "boolean") value = value ? "Yes" : "No";
				return String(value ?? "").padEnd(colWidths[col]);
			})
			.join(" | ");
		console.log(dataRow);
	});
}

const METHOD_LABELS: Record<string, string> = { credential: "Password", password: "Password", google: "Google", "email-link": "Email link" };

export function methodLabel(method: string | null): string {
	return method ? (METHOD_LABELS[method] ?? method) : "-";
}

const countryNames = new Intl.DisplayNames(["en"], { type: "region" });

export function countryName(code: string | null): string {
	if (!code) return "-";
	try {
		return countryNames.of(code) ?? code;
	} catch {
		return code;
	}
}

/** "2 h 05 min", "3 min", "45 s"; "-" for nothing. */
export function formatDuration(seconds: number | null): string {
	if (seconds === null) return "-";
	if (seconds < 60) return `${seconds} s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes} min`;
	const hours = Math.floor(minutes / 60);
	if (hours < 48) return `${hours} h ${String(minutes % 60).padStart(2, "0")} min`;
	return `${Math.floor(hours / 24)} d ${hours % 24} h`;
}

const STATUS_LABELS: Record<string, string> = { active: "Active", idle: "Idle", unverified: "Unverified", disabled: "Disabled", offline: "-" };

export function printUser(user: CliUserDetails): void {
	const row = (label: string, value: string | number) => console.log(`${`${label}:`.padEnd(18)}${value}`);
	console.log("\nUser Details");
	console.log("=".repeat(40));
	row("ID", user.id);
	row("Email", user.email);
	row("Name", user.name || "N/A");
	row("Role", user.role ?? "user");
	row("Image", user.image || "N/A");
	row("Enabled", user.enabled ? "Yes" : "No (cannot sign in)");
	row("Verified", user.emailVerified ? "Yes" : "No");
	row("Status", STATUS_LABELS[user.status] ?? user.status);
	row("Sign-in with", user.signInMethods.length ? user.signInMethods.map(methodLabel).join(", ") : "-");
	row("Created", formatTimestamp(user.createdAt));
	row("Updated", formatTimestamp(user.updatedAt));

	console.log("\nUsage");
	console.log("-".repeat(30));
	row("Sign-ins", `${user.signIns}${user.failedSignIns ? ` (${user.failedSignIns} failed)` : ""}`);
	row("Last sign-in", formatTimestamp(user.lastSignInAt));
	row("Last sign-out", formatTimestamp(user.lastSignOutAt));
	row("Time in session", formatDuration(user.usageSeconds || null));
	row("History entries", user.activityCount);

	console.log("\nSessions");
	console.log("-".repeat(30));
	row("Active sessions", user.activeSessions);
	if (user.currentSession) {
		row("Idle for", formatDuration(user.idleSeconds));
		row("Last seen", formatTimestamp(user.currentSession.lastSeenAt));
		row("IP", user.currentSession.ip || "-");
		row("Country", countryName(user.currentSession.country));
	}

	if (user.account) {
		console.log("\nPassword Account");
		console.log("-".repeat(30));
		row("Account ID", user.account.accountId);
		row("Has password", user.account.hasPassword ? "Yes" : "No");
		row("Created", formatTimestamp(user.account.createdAt));
		row("Updated", formatTimestamp(user.account.updatedAt));
	}

	console.log("");
}

const EVENT_LABELS: Record<CliActivityEvent["kind"], string> = {
	"sign-in": "Signed in",
	failed: "Failed sign-in",
	"sign-out": "Signed out",
	"session-expired": "Session expired",
	"session-revoked": "Session revoked",
};

export function formatActivityForTable(events: CliActivityEvent[]): UserRow[] {
	return events.map((e) => ({
		when: formatTimestamp(e.createdAt),
		event: EVENT_LABELS[e.kind] ?? e.kind,
		detail: [e.method ? methodLabel(e.method) : "", e.durationSeconds !== null ? formatDuration(e.durationSeconds) : "", e.actor ? `by ${e.actor}` : ""].filter(Boolean).join(" · ") || "-",
		ip: e.ip || "-",
		country: countryName(e.country),
		browser: describeBrowser(e.userAgent).replace("—", "-"),
	}));
}

export function printSuccess(message: string): void {
	console.log(`✅ ${message}`);
}

export function printError(message: string): void {
	console.error(`❌ ${message}`);
}

export function printInfo(message: string): void {
	console.log(message);
}

export function printWarning(message: string): void {
	console.warn(`⚠️  ${message}`);
}

export function formatTimestamp(timestamp: Timestamp | undefined): string {
	if (timestamp === null || timestamp === undefined) return "-";
	// Handle various timestamp formats from API/database
	if (typeof timestamp === "string") {
		return format(new Date(timestamp), "yyyy-MM-dd HH:mm:ss");
	}
	if (timestamp instanceof Date) {
		return format(timestamp, "yyyy-MM-dd HH:mm:ss");
	}
	return format(new Date(timestamp), "yyyy-MM-dd HH:mm:ss");
}

export function formatUsersForTable(users: CliUserSummary[]): UserRow[] {
	return users.map((user) => ({
		id: `${user.id.slice(0, 8)}...`,
		email: user.email,
		name: user.name || "N/A",
		role: user.role ?? "user",
		status: STATUS_LABELS[user.status] ?? user.status,
		enabled: user.enabled ? "Yes" : "No",
		verified: user.emailVerified ? "Yes" : "No",
		"last sign-in": formatTimestamp(user.lastSignInAt),
		"sign-ins": String(user.signIns),
		usage: formatDuration(user.usageSeconds || null),
		created: formatTimestamp(user.createdAt),
	}));
}
