import { Command } from "commander";
import { connectToDatabase, normalizeEnvironment } from "../../utils/db";
import { printError, printSuccess } from "../../utils/output";

type EnvironmentOption = "local" | "preview" | "production";

type SignOutUserOptions = {
	user: string;
	env?: EnvironmentOption;
};

export function createSignOutUserCommand(): Command {
	const command = new Command("sign-out-user");

	command
		.description("End every session of a user, on every device (each is logged as revoked)")
		.requiredOption("-u, --user <email>", "User email address")
		.argument("[environment]", "Target environment (local, preview, production)")
		.option("--env <environment>", "Target environment (local, preview, production)")
		.action(async (environment: string | undefined, options: SignOutUserOptions) => {
			try {
				const env = normalizeEnvironment(options.env, environment);
				const db = await connectToDatabase(env);
				const { sessions = 0 } = await db.signOutUser(options.user);
				printSuccess(`User '${options.user}' signed out everywhere (${sessions} session${sessions === 1 ? "" : "s"} ended)`);
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : "Unknown error";
				printError(`Failed to sign out user: ${message}`);
				process.exit(1);
			}
		});

	return command;
}
