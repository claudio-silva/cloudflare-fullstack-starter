import { Command } from "commander";
import { connectToDatabase } from "../../utils/db";
import { printError, printSuccess, printWarning } from "../../utils/output";
import * as readline from "readline";

type EnvironmentOption = "local" | "preview" | "production";

type DeleteUserOptions = {
	user?: string;
	all?: boolean;
	env: EnvironmentOption;
	force?: boolean;
};

export function createDeleteUserCommand(): Command {
	const command = new Command("delete-user");

	command
		.description("Delete a user or all users and all associated data")
		.option("-u, --user <email>", "User email address (cannot be used with --all)")
		.option("-a, --all", "Delete all users (cannot be used with --user)")
		.option("--env <environment>", "Target environment (local, preview, production)", "local")
		.option("--force", "Skip confirmation prompt")
		.action(async (options: DeleteUserOptions) => {
			try {
				const { user: email, all, env, force } = options;
				if (email && all) {
					printError("Cannot specify both --user and --all options");
					process.exit(1);
				}
				if (!email && !all) {
					printError("Must specify either --user <email> or --all");
					process.exit(1);
				}

				const db = await connectToDatabase(env);

				if (all) {
					if (env === "production") {
						printError("Cannot delete all users in production for safety reasons");
						process.exit(1);
					}

					const users = await db.listUsers();
					if (!users || users.length === 0) {
						printWarning("No users found to delete");
						process.exit(0);
					}

					printWarning(`You are about to delete ALL users (${users.length} users)`);
					if (!force) {
						const confirmed = await confirmDeletion("Are you sure you want to delete ALL users? This cannot be undone.");
						if (!confirmed) {
							console.log("Deletion cancelled");
							process.exit(0);
						}
					}

					await db.deleteAllUsers();
					printSuccess(`Successfully deleted all users (${users.length} users)`);
				} else if (email) {
					const user = await db.getUser(email);
					if (!user) {
						printError(`User with email '${email}' not found`);
						process.exit(1);
					}

					printWarning(`You are about to delete the following user: ${email}`);
					if (!force) {
						const confirmed = await confirmDeletion(`Are you sure you want to delete user '${email}'? This cannot be undone.`);
						if (!confirmed) {
							console.log("Deletion cancelled");
							process.exit(0);
						}
					}

					await db.deleteUser(email);
					printSuccess(`Successfully deleted user '${email}'`);
				}
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : "Unknown error";
				printError(`Failed to delete user${options.all ? "s" : ""}: ${message}`);
				process.exit(1);
			}
		});

	return command;
}

function confirmDeletion(question: string): Promise<boolean> {
	return new Promise((resolve) => {
		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
		});

		rl.question(`${question} (y/N): `, (answer) => {
			rl.close();
			resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
		});
	});
}
