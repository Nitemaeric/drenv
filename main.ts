import { Command } from "npm:commander";

import global from "./commands/global.ts";
import local from "./commands/local.ts";
import newCommand from "./commands/new.ts";
import register from "./commands/register.ts";
import setup from "./commands/setup.ts";
import versions from "./commands/versions.ts";

const program = new Command();

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
  .description("CLI to manage DragonRuby environments.")
  .version("0.2.3");

program.command("setup")
  .description("Setup your shell profile to use drenv.")
  .action(actionRunner(setup));

program.command("new")
  .argument("<name>", "Name of the new project")
  .description("Create a new DragonRuby project.")
  .action(actionRunner(newCommand));

program.command("register")
  .argument("<path>", "Path to a fresh DragonRuby directory")
  .description(
    "Register a DragonRuby installation. This moves the installation to the $HOME/.drenv directory.",
  )
  .action(actionRunner(register));

program.command("global")
  .argument("[version]", "Version of DragonRuby to use")
  .description("Get or set the global version of DragonRuby.")
  .action(actionRunner(global));

program.command("local")
  .argument("[version]", "Version of DragonRuby to use")
  .description("Get or set the local version of DragonRuby.")
  .action(actionRunner(local));

program.command("versions")
  .description("List out all locally installed versions of DragonRuby.")
  .action(actionRunner(versions));

program.parse();
