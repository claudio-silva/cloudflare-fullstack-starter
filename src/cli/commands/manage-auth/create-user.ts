import { Command } from "commander";
import { connectToDatabase, normalizeEnvironment } from "../../utils/db";
import { ROLES, type Role } from "../../../shared/roles";
import { printError, printSuccess, printWarning } from "../../utils/output";

type EnvironmentOption = "local" | "preview" | "production";

type CreateUserOptions = {
	user: string;
	pass: string;
	env?: EnvironmentOption;
	name?: string;
	role?: Role;
	disabled?: boolean;
};

export function createCreateUserCommand(): Command {
	const command = new Command("create-user");

	command
		.description("Create a new user with email/password authentication")
		.requiredOption("-u, --user <email>", "User email address")
		.requiredOption("-p, --pass <password>", "Password (plain text)")
		.argument("[environment]", "Target environment (local, preview, production)")
		.option("--env <environment>", "Target environment (local, preview, production)")
		.option("--name <name>", "User display name")
		.option("-r, --role <role>", `User role: ${ROLES.join(" | ")} (default: user)`)
		.option("--disabled", "Create the account disabled: it cannot sign in until enabled (enable-user)")
		.action(async (environment: string | undefined, options: CreateUserOptions) => {
			try {
				const { user: email, pass: password, name, role, disabled } = options;
				const allowedRoles = ROLES;
				const env = normalizeEnvironment(options.env, environment);
				const db = await connectToDatabase(env);

				if (password.length < 8) {
					printWarning("Password is shorter than 8 characters.");
				}
				if (role && !allowedRoles.includes(role)) {
					throw new Error(`Invalid role '${role}'. Allowed: ${allowedRoles.join(", ")}`);
				}

				await db.createUser({ email, password, name: name || undefined, role, enabled: !disabled });
				printSuccess(`User '${email}' created successfully${role ? ` as ${role}` : ""}${disabled ? " (disabled)" : ""}`);
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : "Unknown error";
				printError(`Failed to create user: ${message}`);
				process.exit(1);
			}
		});

	return command;
}
