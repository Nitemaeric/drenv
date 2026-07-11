import { Command } from "commander";
import { greaterThan, tryParse } from "@std/semver";

import config from "./deno.json" with { type: "json" };

import add from "./commands/add.ts";
import list from "./commands/list.ts";
import update from "./commands/update.ts";
import outdated from "./commands/outdated.ts";
import bundle from "./commands/bundle.ts";
import changelog from "./commands/changelog.ts";
import install from "./commands/install.ts";
import use from "./commands/use.ts";
import version from "./commands/version.ts";
import newCommand from "./commands/new.ts";
import build from "./commands/build.ts";
import publish from "./commands/publish.ts";
import register from "./commands/register.ts";
import uninstall from "./commands/uninstall.ts";
import remove from "./commands/remove.ts";
import run from "./commands/run.ts";
import selfUpdate from "./commands/self-update.ts";
import lsp from "./lsp/server.ts";
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
      `drenv update available. \`drenv self-update\` to install v${latest}`,
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

// Help groupings shown as headings in `drenv --help`.
const ENGINE = "Engine management:";
const PROJECT = "Project management:";
const DEPENDENCIES = "Dependency management:";
const DRENV = "Managing drenv:";

program
  .name("drenv")
  .description("CLI to manage DragonRuby environments")
  .version(config.version)
  // Restrict the program's `--version` to before a subcommand, so `new` can
  // accept its own `--version <version>` option.
  .enablePositionalOptions();

// --- Engine management ------------------------------------------------------

program
  .command("install")
  .option(
    "--tier <tier>",
    "DragonRuby tier: standard, indie, or pro (prompts if unset)",
  )
  .description("Install the latest version of DragonRuby GTK")
  .helpGroup(ENGINE)
  .action(actionRunner(install));

program
  .command("register")
  .argument("<path>", "Path to a fresh DragonRuby directory")
  .option(
    "--tier <tier>",
    "Tier this install belongs to: standard, indie, or pro (default standard)",
  )
  .summary("Register a DragonRuby installation")
  .description(
    "Register a DragonRuby installation. This moves the installation to the $HOME/.drenv directory.",
  )
  .helpGroup(ENGINE)
  .action(actionRunner(register));

program
  .command("uninstall")
  .argument(
    "<version>",
    "Version to remove (tier-resolved, e.g. 7.11 or 7.11-pro)",
  )
  .option("-y, --yes", "Skip the confirmation prompt")
  .description("Remove an installed DragonRuby version")
  .helpGroup(ENGINE)
  .action(actionRunner(uninstall));

program
  .command("versions")
  .description("List out all locally installed versions of DragonRuby")
  .helpGroup(ENGINE)
  .action(actionRunner(versions));

program
  .command("changelog")
  .argument("[version]", "Version of DragonRuby to print the changelog for")
  .description(
    "Print the changelog entry for a version (defaults to the latest installed)",
  )
  .helpGroup(ENGINE)
  .action(actionRunner(changelog));

// --- Project management ------------------------------------------------------

program
  .command("new")
  .argument("<name>", "Name of the new project")
  .option(
    "--version <version>",
    "DragonRuby version to use (defaults to the latest installed)",
  )
  .option("--skip-gitignore", "Don't generate a .gitignore in the new project")
  .description("Create a new DragonRuby project")
  .helpGroup(PROJECT)
  .action(actionRunner(newCommand));

program
  .command("use")
  .argument(
    "[version]",
    "Version to switch the project to (defaults to the latest installed)",
  )
  .description("Switch the current project to a DragonRuby version")
  .helpGroup(PROJECT)
  .action(actionRunner(use));

program
  .command("version")
  .description("Print the current project's DragonRuby version")
  .helpGroup(PROJECT)
  .action(actionRunner(version, { skipUpdateCheck: true }));

program
  .command("run")
  .argument("[args...]", "Arguments forwarded to the dragonruby binary")
  .option("--frozen", "Verify against the lockfile instead of updating it")
  .option("--no-watch", "Don't re-sync path dependencies as they change")
  .allowUnknownOption()
  .description("Sync dependencies and launch the project with DragonRuby")
  .helpGroup(PROJECT)
  .action(actionRunner(run, { skipUpdateCheck: true }));

program
  .command("build")
  .argument("[args...]", "Arguments forwarded to dragonruby-publish")
  .allowUnknownOption()
  .description(
    "Package the project locally (dragonruby-publish --only-package)",
  )
  .helpGroup(PROJECT)
  .action(actionRunner(build, { skipUpdateCheck: true }));

program
  .command("publish")
  .argument("[args...]", "Arguments forwarded to dragonruby-publish")
  .allowUnknownOption()
  .description(
    "Verify dependencies against the lockfile, then publish with dragonruby-publish",
  )
  .helpGroup(PROJECT)
  .action(actionRunner(publish, { skipUpdateCheck: true }));

// --- Dependency management --------------------------------------------------

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
  .helpGroup(DEPENDENCIES)
  .action(actionRunner(add));

program
  .command("remove")
  .argument("<name>", "Name of the dependency to remove")
  .description("Remove a dependency from mygame/drenv.toml")
  .helpGroup(DEPENDENCIES)
  .action(actionRunner(remove));

program
  .command("list")
  .description("List the project's dependencies and their locked revisions")
  .helpGroup(DEPENDENCIES)
  .action(actionRunner(list));

program
  .command("update")
  .argument("[name]", "Dependency to update (default: all)")
  .description(
    "Re-resolve dependencies to their latest and update the lockfile",
  )
  .helpGroup(DEPENDENCIES)
  .action(actionRunner(update));

program
  .command("outdated")
  .description("Show dependencies whose upstream has moved past the lockfile")
  .helpGroup(DEPENDENCIES)
  .action(actionRunner(outdated));

program
  .command("bundle")
  .option("--frozen", "Verify against the lockfile instead of updating it")
  .description("Resolve and vendor dependencies from mygame/drenv.toml")
  .helpGroup(DEPENDENCIES)
  .action(actionRunner(bundle));

// --- Managing drenv ---------------------------------------------------------

program
  .command("lsp")
  .description("Start the DragonRuby language server (experimental spike)")
  .helpGroup(PROJECT)
  .action(lsp);

program
  .command("self-update")
  .description("Update drenv itself to the latest version")
  .helpGroup(DRENV)
  .action(actionRunner(selfUpdate, { skipUpdateCheck: true }));

program.parse();
