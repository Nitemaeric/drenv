import { Command } from "npm:commander";
import { copy, move } from "jsr:@std/fs";

import global from "./commands/global.ts";

import { readFirstLine } from "./utils/read-first-line.ts";

const program = new Command();

const actionRunner = (fn: (...args: any[]) => Promise<any>) => {
  return (...args: any[]): any =>
    fn(...args)
      .then(
        (value) =>
          typeof value === "string" ||
          typeof value === "number" && console.log(value),
      )
      .catch(
        (error) => console.error(error.message),
      );
};

program
  .name("drenv")
  .description("CLI to manage DragonRuby environments.")
  .version("0.1.1");

program.command("new")
  .argument("<name>", "Name of the new project")
  .description("Create a new DragonRuby project.")
  .action(async (name) => {
    await copy(
      `${Deno.env.get("HOME")}/.drenv/versions/${await global()}`,
      name,
    );
  });

program.command("register")
  .argument("<path>", "Path to a fresh DragonRuby directory")
  .description("Register a DragonRuby installation. This moves the installation to the $HOME/.drenv directory.")
  .action(async (path) => {
    const content = await readFirstLine(path + "/CHANGELOG-CURR.txt");
    const version = content.match(/[0-9\.]+/)?.[0];

    await move(path, `${Deno.env.get("HOME")}/.drenv/versions/${version}`);
  });

program.command("global")
  .argument("[version]", "Version of DragonRuby to use")
  .description("Get or set the global version of DragonRuby.")
  .action(actionRunner(global));

program.command("versions")
  .description("List out all locally installed versions of DragonRuby.")
  .action(async (options) => {
    const directories = await Deno.readDir(
      `${Deno.env.get("HOME")}/.drenv/versions/`,
    );

    let currentVersion;

    try {
      const content = await readFirstLine("./CHANGELOG-CURR.txt");

      currentVersion = content.match(/[0-9\.]+/)?.[0];
    } catch (error) {}

    for await (const directory of directories) {
      if (directory.name == currentVersion) {
        console.log("* " + directory.name);
      } else {
        console.log("  " + directory.name);
      }
    }
  });

program.parse();
