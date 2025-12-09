import { Command } from "commander";
import { connectToDatabase } from "../../utils/db";
import { printError, printSuccess } from "../../utils/output";

export function createActivateUserCommand(): Command {
	const command = new Command("activate-user");

	command
		.description("Activate or deactivate a user account")
		.requiredOption("-u, --user <email>", "User email address")
		.requiredOption("-s, --status <on|off>", "Activation status (on or off)")
		.option("--env <environment>", "Target environment (local, preview, production)", "local")
		.action(async (options) => {
			try {
				const { user: email, status, env } = options;
				if (!["on", "off"].includes(status)) {
					printError('Status must be either "on" or "off"');
					process.exit(1);
				}

				const activated = status === "on";
				const db = await connectToDatabase(env as "local" | "preview" | "production");
				await (db as any).activateUser(email, activated);
				printSuccess(`User '${email}' ${activated ? "activated" : "deactivated"} successfully`);
			} catch (error: any) {
				printError(`Failed to ${options.status === "on" ? "activate" : "deactivate"} user: ${error.message}`);
				process.exit(1);
			}
		});

	return command;
}
import { Command } from "commander";
import { connectToDatabase } from "../../utils/db";
import { printError, printSuccess } from "../../utils/output";

export function createActivateUserCommand(): Command {
	const command = new Command("activate-user");

	command
		.description("Activate or deactivate a user account")
		.requiredOption("-u, --user <email>", "User email address")
		.requiredOption("-s, --status <on|off>", "Activation status (on or off)")
		.option("--env <environment>", "Target environment (local, preview, production)", "local")
		.action(async (options) => {
			try {
				const { user: email, status, env } = options;
				if (!["on", "off"].includes(status)) {
					printError('Status must be either "on" or "off"');
					process.exit(1);
				}

				const activated = status === "on";
				const db = await connectToDatabase(env as "local" | "preview" | "production");
				await (db as any).activateUser(email, activated);
				printSuccess(`User '${email}' ${activated ? "activated" : "deactivated"} successfully`);
			} catch (error: any) {
				printError(`Failed to ${options.status === "on" ? "activate" : "deactivate"} user: ${error.message}`);
				process.exit(1);
			}
		});

	return command;
}
