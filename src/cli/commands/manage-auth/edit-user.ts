import { Command } from "commander";
import { connectToDatabase } from "../../utils/db";
import { printError, printSuccess, printWarning } from "../../utils/output";

export function createEditUserCommand(): Command {
	const command = new Command("edit-user");

	command
		.description("Edit user information (name, email, password)")
		.requiredOption("-u, --user <email>", "Current user email address")
		.option("-n, --name <name>", "New display name")
		.option("-e, --email <email>", "New email address")
		.option("-p, --pass <password>", "New password (plain text)")
		.option("--env <environment>", "Target environment (local, preview, production)", "local")
		.action(async (options) => {
			try {
				const { user: currentEmail, name, email: newEmail, pass: password, env } = options;
				if (!name && !newEmail && !password) {
					printError("Must specify at least one field to update (--name, --email, or --pass)");
					process.exit(1);
				}

				const db = await connectToDatabase(env as "local" | "preview" | "production");

				if (password && password.length < 8) {
					printWarning("Password is shorter than 8 characters.");
				}

				const updateData: any = {};
				if (name !== undefined) updateData.name = name;
				if (newEmail) updateData.email = newEmail;
				if (password) updateData.password = password;

				await (db as any).editUser(currentEmail, updateData);

				const changes = [];
				if (name !== undefined) changes.push("name");
				if (newEmail) changes.push("email");
				if (password) changes.push("password");

				printSuccess(`User '${currentEmail}' updated successfully (${changes.join(", ")})`);
			} catch (error: any) {
				printError(`Failed to edit user: ${error.message}`);
				process.exit(1);
			}
		});

	return command;
}
