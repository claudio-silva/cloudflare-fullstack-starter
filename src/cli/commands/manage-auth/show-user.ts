import { Command } from "commander";
import { connectToDatabase } from "../../utils/db";
import { printUser, printError } from "../../utils/output";

type EnvironmentOption = "local" | "preview" | "production";

type ShowUserOptions = {
	user: string;
	env: EnvironmentOption;
};

export function createShowUserCommand(): Command {
	const command = new Command("show-user");

	command
		.description("Show detailed information about a user")
		.requiredOption("-u, --user <email>", "User email address")
		.option("--env <environment>", "Target environment (local, preview, production)", "local")
		.action(async (options: ShowUserOptions) => {
			try {
				const { user: email, env } = options;
				const db = await connectToDatabase(env);
				const user = await db.getUser(email);

				if (!user) {
					printError(`User with email '${email}' not found`);
					process.exit(1);
				}

				printUser(user);
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : "Unknown error";
				printError(`Failed to show user: ${message}`);
				process.exit(1);
			}
		});

	return command;
}
