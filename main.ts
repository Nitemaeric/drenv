import { Argument, Command } from "commander";
import { greaterThan, tryParse } from "@std/semver";

import config from "./deno.json" with { type: "json" };

import add from "./commands/add.ts";
import bundle from "./commands/bundle.ts";
import changelog from "./commands/changelog.ts";
import global from "./commands/global.ts";
import install from "./commands/install.ts";
import update from "./commands/update.ts";
import newCommand from "./commands/new.ts";
import publish from "./commands/publish.ts";
import register from "./commands/register.ts";
import remove from "./commands/remove.ts";
import run from "./commands/run.ts";
import setup from "./commands/setup.ts";
import upgrade from "./commands/upgrade.ts";
import versions from "./commands/versions.ts";

import { getLatestDrenvVersion } from "./utils/latest-drenv-version.ts";

export const program = new Command();

const printDrenvUpdateNotice = async () => {
  const latest = await getLatestDrenvVersion();
  if (!latest) return;

  const latestParsed = tryParse(latest);
  const currentParsed = tryParse(config.version);
  if (!latestParsed || !currentParsed) return;

  if (greaterThan(latestParsed, currentParsed)) {
    console.log(
      `drenv update available. \`drenv upgrade\` to install v${latest}`,
    );
  }
};

// deno-lint-ignore no-explicit-any
type CommandAction = (...args: any[]) => Promise<unknown>;

const actionRunner = (
  fn: CommandAction,
  options: { skipUpdateCheck?: boolean } = {},
) => {
  return async (...args: unknown[]): Promise<void> => {
    try {
      const value = await fn(...args);
      if (typeof value === "string" || typeof value === "number") {
        console.log(value);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
    } finally {
      if (!options.skipUpdateCheck) {
        await printDrenvUpdateNotice();
      }
    }
  };
};

program
  .name("drenv")
  .description("CLI to manage DragonRuby environments")
  .version(config.version);

program
  .command("setup")
  .description("Setup your shell profile to use drenv")
  .action(actionRunner(setup));

program
  .command("new")
  .argument("<name>", "Name of the new project")
  .description("Create a new DragonRuby project")
  .action(actionRunner(newCommand));

program
  .command("register")
  .argument("<path>", "Path to a fresh DragonRuby directory")
  .summary("Register a DragonRuby installation")
  .description(
    "Register a DragonRuby installation. This moves the installation to the $HOME/.drenv directory.",
  )
  .action(actionRunner(register));

program
  .command("bundle")
  .option("--frozen", "Verify against the lockfile instead of updating it")
  .description("Resolve and vendor dependencies from mygame/drenv.toml")
  .action(actionRunner(bundle));

program
  .command("run")
  .argument("[args...]", "Arguments forwarded to the dragonruby binary")
  .option("--frozen", "Verify against the lockfile instead of updating it")
  .allowUnknownOption()
  .description("Sync dependencies and launch the project with DragonRuby")
  .action(actionRunner(run, { skipUpdateCheck: true }));

program
  .command("add")
  .argument(
    "<source>",
    "Dependency source: github:owner/repo[@tag], git:<url>, url:<url>, path:<dir>",
  )
  .option(
    "-e, --entrypoint <file>",
    "File to require, relative to the dependency",
  )
  .option(
    "-n, --name <name>",
    "Dependency name (defaults to the repo/file name)",
  )
  .option("--tag <tag>", "Tag to pin (github/git)")
  .option("--branch <branch>", "Branch to track (github/git)")
  .option("--ref <ref>", "Commit or ref to pin (github/git)")
  .description("Add a dependency to mygame/drenv.toml and vendor it")
  .action(actionRunner(add));

program
  .command("remove")
  .argument("<name>", "Name of the dependency to remove")
  .description("Remove a dependency from mygame/drenv.toml")
  .action(actionRunner(remove));

program
  .command("publish")
  .argument("[args...]", "Arguments forwarded to dragonruby-publish")
  .allowUnknownOption()
  .description(
    "Verify dependencies against the lockfile, then publish with dragonruby-publish",
  )
  .action(actionRunner(publish, { skipUpdateCheck: true }));

program
  .command("global")
  .argument("[version]", "Version of DragonRuby to use")
  .description("Get or set the global version of DragonRuby")
  .action(actionRunner(global));

program
  .command("update")
  .argument("[version]", "Version of DragonRuby to use")
  .description("Get or set the local version of DragonRuby")
  .action(actionRunner(update));

program
  .command("changelog")
  .argument("[version]", "Version of DragonRuby to print the changelog for")
  .description(
    "Print the changelog entry for a version (defaults to the latest installed)",
  )
  .action(actionRunner(changelog));

program
  .command("versions")
  .description("List out all locally installed versions of DragonRuby")
  .action(actionRunner(versions));

program
  .command("upgrade")
  .description("Upgrade the version of drenv")
  .action(actionRunner(upgrade, { skipUpdateCheck: true }));

program
  .command("install")
  .addArgument(
    new Argument("[tier]", "Tier of DragonRuby to install")
      .choices(["standard", "indie", "pro"])
      .default("standard"),
  )
  .description("Install the latest version of drenv")
  .action(actionRunner(install));

program.parse();
