import { Command } from "commander";
import { connectToDatabase } from "../../utils/db";
import { printError, printSuccess, printWarning } from "../../utils/output";

type EnvironmentOption = "local" | "preview" | "production";

type EditUserOptions = {
	user: string;
	name?: string;
	email?: string;
	pass?: string;
	env: EnvironmentOption;
};

type UpdateData = {
	name?: string;
	email?: string;
	password?: string;
};

export function createEditUserCommand(): Command {
	const command = new Command("edit-user");

	command
		.description("Edit user information (name, email, password)")
		.requiredOption("-u, --user <email>", "Current user email address")
		.option("-n, --name <name>", "New display name")
		.option("-e, --email <email>", "New email address")
		.option("-p, --pass <password>", "New password (plain text)")
		.option("--env <environment>", "Target environment (local, preview, production)", "local")
		.action(async (options: EditUserOptions) => {
			try {
				const { user: currentEmail, name, email: newEmail, pass: password, env } = options;
				if (!name && !newEmail && !password) {
					printError("Must specify at least one field to update (--name, --email, or --pass)");
					process.exit(1);
				}

				const db = await connectToDatabase(env);

				if (password && password.length < 8) {
					printWarning("Password is shorter than 8 characters.");
				}

				const updateData: UpdateData = {};
				if (name !== undefined) updateData.name = name;
				if (newEmail) updateData.email = newEmail;
				if (password) updateData.password = password;

				await db.editUser(currentEmail, updateData);

				const changes = [];
				if (name !== undefined) changes.push("name");
				if (newEmail) changes.push("email");
				if (password) changes.push("password");

				printSuccess(`User '${currentEmail}' updated successfully (${changes.join(", ")})`);
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : "Unknown error";
				printError(`Failed to edit user: ${message}`);
				process.exit(1);
			}
		});

	return command;
}
