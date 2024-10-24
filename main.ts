import { Command } from "npm:commander";

import add from "./commands/add.ts";
import global from "./commands/global.ts";
import local from "./commands/local.ts";
import newCommand from "./commands/new.ts";
import register from "./commands/register.ts";
import setup from "./commands/setup.ts";
import upgrade from "./commands/upgrade.ts";
import versions from "./commands/versions.ts";

import { version } from "./constants.ts";

export const program = new Command();

const actionRunner = (fn: (...args: any[]) => Promise<any>) => {
  return (...args: any[]): any =>
    fn(...args)
      .then(
        (value) =>
          (typeof value === "string" ||
            typeof value === "number") && console.log(value),
      )
      .catch(
        (error) => console.error(error.message),
      );
};

program
  .name("drenv")
  .description("CLI to manage DragonRuby environments")
  .version(version);

program.command("setup")
  .description("Setup your shell profile to use drenv")
  .action(actionRunner(setup));

program.command("new")
  .argument("<name>", "Name of the new project")
  .description("Create a new DragonRuby project")
  .action(actionRunner(newCommand));

program.command("register")
  .argument("<path>", "Path to a fresh DragonRuby directory")
  .summary("Register a DragonRuby installation")
  .description(
    "Register a DragonRuby installation. This moves the installation to the $HOME/.drenv directory.",
  )
  .action(actionRunner(register));

program.command("add")
  .argument("<recipe>", "Name of the recipe to add")
  .description("Setup a pre-configured library")
  .action(actionRunner(add));

program.command("global")
  .argument("[version]", "Version of DragonRuby to use")
  .description("Get or set the global version of DragonRuby")
  .action(actionRunner(global));

program.command("local")
  .argument("[version]", "Version of DragonRuby to use")
  .description("Get or set the local version of DragonRuby")
  .action(actionRunner(local));

program.command("versions")
  .description("List out all locally installed versions of DragonRuby")
  .action(actionRunner(versions));

program.command("upgrade")
  .description("Upgrade the version of drenv")
  .action(actionRunner(upgrade));

program.parse();
