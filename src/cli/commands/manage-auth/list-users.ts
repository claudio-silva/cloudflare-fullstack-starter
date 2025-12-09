import { Command } from "commander";
import { connectToDatabase } from "../../utils/db";
import { printTable, formatUsersForTable, printError, printInfo } from "../../utils/output";

export function createListUsersCommand(): Command {
	const command = new Command("list-users");

	command
		.description("List users from the database")
		.option("--limit <number>", "Maximum number of users to show (default: 50)", "50")
		.option("--search <terms>", "Search users by partial email or name")
		.option("--env <environment>", "Target environment (local, preview, production)", "local")
		.action(async (options) => {
			try {
				const { limit, search, env } = options;
				const limitNum = parseInt(limit, 10);

				if (isNaN(limitNum) || limitNum < 1) {
					printError("Limit must be a positive number");
					process.exit(1);
				}

				const db = await connectToDatabase(env as "local" | "preview" | "production");
				const users = await (db as any).listUsers({ search, limit: limitNum });

				if (!users || users.length === 0) {
					printInfo("No users found");
					return;
				}

				printTable(formatUsersForTable(users), ["email", "name", "verified", "created"]);
			} catch (error: any) {
				printError(`Failed to list users: ${error.message}`);
				process.exit(1);
			}
		});

	return command;
}
