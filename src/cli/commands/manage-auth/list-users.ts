import { Command } from "commander";
import { connectToDatabase } from "../../utils/db";
import { printTable, formatUsersForTable, printError, printInfo } from "../../utils/output";

type EnvironmentOption = "local" | "preview" | "production";

type ListUsersOptions = {
	limit: string;
	search?: string;
	env: EnvironmentOption;
};

export function createListUsersCommand(): Command {
	const command = new Command("list-users");

	command
		.description("List users from the database")
		.option("--limit <number>", "Maximum number of users to show (default: 50)", "50")
		.option("--search <terms>", "Search users by partial email or name")
		.option("--env <environment>", "Target environment (local, preview, production)", "local")
		.action(async (options: ListUsersOptions) => {
			try {
				const { limit, search, env } = options;
				const limitNum = parseInt(limit, 10);

				if (Number.isNaN(limitNum) || limitNum < 1) {
					printError("Limit must be a positive number");
					process.exit(1);
				}

				const db = await connectToDatabase(env);
				const users = await db.listUsers({ search, limit: limitNum });

				if (!users || users.length === 0) {
					printInfo("No users found");
					return;
				}

				printTable(formatUsersForTable(users), ["email", "name", "verified", "created"]);
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : "Unknown error";
				printError(`Failed to list users: ${message}`);
				process.exit(1);
			}
		});

	return command;
}
