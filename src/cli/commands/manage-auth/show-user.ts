import { Command } from "commander";
import { connectToDatabase } from "../../utils/db";
import { printUser, printError } from "../../utils/output";

export function createShowUserCommand(): Command {
	const command = new Command("show-user");

	command
		.description("Show detailed information about a user")
		.requiredOption("-u, --user <email>", "User email address")
		.option("--env <environment>", "Target environment (local, preview, production)", "local")
		.action(async (options) => {
			try {
				const { user: email, env } = options;
				const db = await connectToDatabase(env as "local" | "preview" | "production");
				const user = await (db as any).getUser(email);

				if (!user) {
					printError(`User with email '${email}' not found`);
					process.exit(1);
				}

				printUser(user);
			} catch (error: any) {
				printError(`Failed to show user: ${error.message}`);
				process.exit(1);
			}
		});

	return command;
}
