import { Command } from "commander";
import { connectToDatabase, normalizeEnvironment } from "../../utils/db";
import { printError, printSuccess } from "../../utils/output";

type EnvironmentOption = "local" | "preview" | "production";

type EnableUserOptions = {
	user: string;
	status: "on" | "off";
	env?: EnvironmentOption;
};

/** Enabled is not Verified: a disabled user cannot sign in at all, whatever their email. */
export function createEnableUserCommand(): Command {
	const command = new Command("enable-user");

	command
		.description("Enable (on) or disable (off) sign-in for a user. Disabling signs them out everywhere")
		.requiredOption("-u, --user <email>", "User email address")
		.requiredOption("-s, --status <on|off>", "Enabled (on) or disabled (off)")
		.argument("[environment]", "Target environment (local, preview, production)")
		.option("--env <environment>", "Target environment (local, preview, production)")
		.action(async (environment: string | undefined, options: EnableUserOptions) => {
			try {
				const { user: email, status } = options;
				const env = normalizeEnvironment(options.env, environment);
				if (!["on", "off"].includes(status)) {
					printError('Status must be either "on" or "off"');
					process.exit(1);
				}

				const enabled = status === "on";
				const db = await connectToDatabase(env);
				await db.setEnabled(email, enabled);
				printSuccess(`User '${email}' ${enabled ? "enabled" : "disabled and signed out everywhere"}`);
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : "Unknown error";
				printError(`Failed to ${options.status === "on" ? "enable" : "disable"} user: ${message}`);
				process.exit(1);
			}
		});

	return command;
}
