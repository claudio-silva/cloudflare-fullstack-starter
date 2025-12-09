import { Command } from "commander";
import { connectToDatabase } from "../../utils/db";
import { printError, printSuccess, printWarning } from "../../utils/output";

type EnvironmentOption = "local" | "preview" | "production";

type CreateUserOptions = {
	user: string;
	pass: string;
	env: EnvironmentOption;
	name?: string;
};

export function createCreateUserCommand(): Command {
	const command = new Command("create-user");

	command
		.description("Create a new user with email/password authentication")
		.requiredOption("-u, --user <email>", "User email address")
		.requiredOption("-p, --pass <password>", "Password (plain text)")
		.option("--env <environment>", "Target environment (local, preview, production)", "local")
		.option("--name <name>", "User display name")
		.action(async (options: CreateUserOptions) => {
			try {
				const { user: email, pass: password, env, name } = options;
				const db = await connectToDatabase(env);

				if (password.length < 8) {
					printWarning("Password is shorter than 8 characters.");
				}

				await db.createUser({ email, password, name: name || undefined });
				printSuccess(`User '${email}' created successfully`);
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : "Unknown error";
				printError(`Failed to create user: ${message}`);
				process.exit(1);
			}
		});

	return command;
}
