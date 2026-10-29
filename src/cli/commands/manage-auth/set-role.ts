import { Command } from "commander";
import { connectToDatabase, normalizeEnvironment } from "../../utils/db";
import { ROLES, type Role } from "../../../shared/roles";
import { printError, printSuccess } from "../../utils/output";

type EnvironmentOption = "local" | "preview" | "production";

type SetRoleOptions = {
	user: string;
	role: string;
	env?: EnvironmentOption;
};

export function createSetRoleCommand(): Command {
	const command = new Command("set-role");

	command
		.description(`Set a user's role (${ROLES.join(", ")}). More roles can be added in src/shared/roles.ts.`)
		.requiredOption("-u, --user <email>", "User email address")
		.requiredOption("-r, --role <role>", `Role: ${ROLES.join(" | ")}`)
		.argument("[environment]", "Target environment (local, preview, production)")
		.option("--env <environment>", "Target environment (local, preview, production)")
		.action(async (environment: string | undefined, options: SetRoleOptions) => {
			try {
				const { user: email, role } = options;
				const env = normalizeEnvironment(options.env, environment);
				const allowed: readonly string[] = ROLES;
				if (!allowed.includes(role)) {
					printError(`Role must be one of: ${allowed.join(", ")}`);
					process.exit(1);
				}
				const db = await connectToDatabase(env);
				await db.setRole(email, role as Role);
				printSuccess(`Role for '${email}' set to '${role}'`);
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : "Unknown error";
				printError(`Failed to set role: ${message}`);
				process.exit(1);
			}
		});

	return command;
}
