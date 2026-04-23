import { Command } from "commander";
import { createListUsersCommand } from "../src/cli/commands/manage-auth/list-users";
import { createShowUserCommand } from "../src/cli/commands/manage-auth/show-user";
import { createDeleteUserCommand } from "../src/cli/commands/manage-auth/delete-user";
import { createEditUserCommand } from "../src/cli/commands/manage-auth/edit-user";
import { createCreateUserCommand } from "../src/cli/commands/manage-auth/create-user";
import { createActivateUserCommand } from "../src/cli/commands/manage-auth/activate-user";
import { createSetRoleCommand } from "../src/cli/commands/manage-auth/set-role";

const program = new Command();

program.name("auth").description("Manage user authentication").version("1.0.0");

program.addCommand(createListUsersCommand());
program.addCommand(createShowUserCommand());
program.addCommand(createDeleteUserCommand());
program.addCommand(createEditUserCommand());
program.addCommand(createCreateUserCommand());
program.addCommand(createActivateUserCommand());
program.addCommand(createSetRoleCommand());

program.parse();
