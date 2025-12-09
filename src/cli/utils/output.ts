import { format } from "date-fns";

export function printTable(data: any[], columns: string[]): void {
	if (!data || data.length === 0) {
		console.log("No data to display");
		return;
	}

	const colWidths: { [key: string]: number } = {};
	columns.forEach((col) => {
		colWidths[col] = Math.max(col.length, ...data.map((row) => String(row[col] || "").length));
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
				return String(value || "").padEnd(colWidths[col]);
			})
			.join(" | ");
		console.log(dataRow);
	});
}

export function printUser(user: any): void {
	console.log("\nUser Details");
	console.log("=".repeat(40));
	console.log(`ID:          ${user.id}`);
	console.log(`Email:       ${user.email}`);
	console.log(`Name:        ${user.name || "N/A"}`);
	console.log(`Image:       ${user.image || "N/A"}`);
	console.log(`Verified:    ${user.emailVerified ? "Yes" : "No"}`);
	console.log(`Created:     ${format(new Date(user.createdAt), "yyyy-MM-dd HH:mm:ss")}`);
	console.log(`Updated:     ${format(new Date(user.updatedAt), "yyyy-MM-dd HH:mm:ss")}`);

	if (user.account) {
		console.log("\nAccount Details");
		console.log("-".repeat(30));
		console.log(`Provider:    ${user.account.providerId}`);
		console.log(`Account ID:  ${user.account.accountId}`);
		console.log(`Has Password: ${user.account.password ? "Yes" : "No"}`);
		console.log(`Created:     ${format(new Date(user.account.createdAt), "yyyy-MM-dd HH:mm:ss")}`);
		console.log(`Updated:     ${format(new Date(user.account.updatedAt), "yyyy-MM-dd HH:mm:ss")}`);
	}

	if (user.sessions !== undefined) {
		console.log("\nSession Info");
		console.log("-".repeat(20));
		console.log(`Active Sessions: ${user.sessions}`);
	}

	console.log("");
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

export function formatTimestamp(timestamp: number): string {
	return format(new Date(timestamp), "yyyy-MM-dd HH:mm:ss");
}

export function formatUsersForTable(users: any[]): any[] {
	return users.map((user) => ({
		id: user.id.slice(0, 8) + "...",
		email: user.email,
		name: user.name || "N/A",
		verified: user.emailVerified ? "Yes" : "No",
		created: formatTimestamp(user.createdAt),
	}));
}
