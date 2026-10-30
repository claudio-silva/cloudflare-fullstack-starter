import { Command } from "commander";
import { connectToDatabase, normalizeEnvironment } from "../../utils/db";
import { printError, printSuccess } from "../../utils/output";

type EnvironmentOption = "local" | "preview" | "production";

type ActivateUserOptions = {
	user: string;
	status: "on" | "off";
	env?: EnvironmentOption;
};

export function createActivateUserCommand(): Command {
	const command = new Command("activate-user");

	command
		.alias("verify-user")
		.description("Mark a user's email address as verified (on) or not (off). To block sign-in, use enable-user")
		.requiredOption("-u, --user <email>", "User email address")
		.requiredOption("-s, --status <on|off>", "Verified (on) or not (off)")
		.argument("[environment]", "Target environment (local, preview, production)")
		.option("--env <environment>", "Target environment (local, preview, production)")
		.action(async (environment: string | undefined, options: ActivateUserOptions) => {
			try {
				const { user: email, status } = options;
				const env = normalizeEnvironment(options.env, environment);
				if (!["on", "off"].includes(status)) {
					printError('Status must be either "on" or "off"');
					process.exit(1);
				}

				const activated = status === "on";
				const db = await connectToDatabase(env);
				await db.activateUser(email, activated);
				printSuccess(`User '${email}' marked as ${activated ? "verified" : "not verified"}`);
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : "Unknown error";
				printError(`Failed to change the verification of the user: ${message}`);
				process.exit(1);
			}
		});

	return command;
}
