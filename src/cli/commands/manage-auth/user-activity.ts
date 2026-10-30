import { Command } from "commander";
import { connectToDatabase, normalizeEnvironment } from "../../utils/db";
import { formatActivityForTable, printError, printInfo, printTable } from "../../utils/output";

type EnvironmentOption = "local" | "preview" | "production";

type UserActivityOptions = {
	user: string;
	limit: string;
	env?: EnvironmentOption;
};

export function createUserActivityCommand(): Command {
	const command = new Command("user-activity");

	command
		.description("Show a user's sign-in history, newest first: sign-ins (failed too), sign-outs, expired and revoked sessions")
		.requiredOption("-u, --user <email>", "User email address")
		.option("--limit <number>", "Maximum number of entries (default: 20, at most 500)", "20")
		.argument("[environment]", "Target environment (local, preview, production)")
		.option("--env <environment>", "Target environment (local, preview, production)")
		.action(async (environment: string | undefined, options: UserActivityOptions) => {
			try {
				const env = normalizeEnvironment(options.env, environment);
				const limit = parseInt(options.limit, 10);
				if (Number.isNaN(limit) || limit < 1) {
					printError("Limit must be a positive number");
					process.exit(1);
				}

				const db = await connectToDatabase(env);
				const events = await db.userActivity(options.user, limit);
				if (events.length === 0) {
					printInfo("No activity recorded");
					return;
				}
				printTable(formatActivityForTable(events), ["when", "event", "detail", "ip", "country", "browser"]);
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : "Unknown error";
				printError(`Failed to show user activity: ${message}`);
				process.exit(1);
			}
		});

	return command;
}
