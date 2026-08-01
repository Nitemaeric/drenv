import { versionsPath } from "../constants.ts";
import { copyTree } from "../utils/copy-tree.ts";
import {
  askTemplate,
  PRIVATE_GITIGNORE,
  PUBLIC_GITIGNORE,
} from "../utils/gitignore.ts";
import {
  latestInstalledVersion,
  resolveVersionDir,
} from "../utils/installed-versions.ts";
import { versionLabel } from "../utils/tier.ts";

export class NotInstalled extends Error {
  version: string;

  constructor(version: string) {
    super(`drenv: version '${version}' not installed`);

    this.name = "NotInstalled";
    this.version = version;
  }
}

type NewOptions = {
  version?: string;
  skipGitignore?: boolean;
  skipGit?: boolean;
  public?: boolean;
  private?: boolean;
};

export default async function newCommand(
  name: string,
  options: NewOptions = {},
) {
  if (options.public && options.private) {
    throw new Error("drenv: --public and --private are mutually exclusive");
  }
  if (options.skipGitignore && (options.public || options.private)) {
    throw new Error(
      "drenv: --skip-gitignore conflicts with --public/--private",
    );
  }

  // Default to the newest installed version; --version picks a specific one.
  const dir = options.version
    ? await resolveVersionDir(options.version)
    : await latestInstalledVersion();

  if (!dir) {
    if (options.version) {
      throw new NotInstalled(options.version);
    }
    throw new Error(
      "drenv: no DragonRuby versions installed — run `drenv install` first",
    );
  }

  // @std/fs copy refused an existing destination; keep that contract now that
  // copyTree merges instead.
  const exists = await Deno.stat(name).then(
    () => true,
    () => false,
  );
  if (exists) {
    throw new Error(`drenv: '${name}' already exists`);
  }
  await copyTree(`${versionsPath}/${dir}`, name);

  if (!options.skipGitignore) {
    let template: string;
    if (options.public) {
      template = PUBLIC_GITIGNORE;
    } else if (options.private) {
      template = PRIVATE_GITIGNORE;
    } else if (options.skipGit) {
      // No repo to ask about; the engine-safe template is the safe default.
      template = PUBLIC_GITIGNORE;
    } else {
      template = askTemplate();
    }
    await Deno.writeTextFile(`${name}/.gitignore`, template);
  }

  let warning = "";
  if (!options.skipGit) {
    const failure = await initGitRepo(name, dir);
    if (failure) {
      warning = `\ndrenv: warning: git setup skipped — ${failure}`;
    }
  }

  return `drenv: Created ${name} (${versionLabel(dir)})${warning}`;
}

/** Initializes a repo in `cwd` with everything committed as
 * `Initial commit. DragonRuby v<dir>`. Returns a failure description instead
 * of throwing — a missing git or unconfigured identity shouldn't undo a
 * project that was created fine. */
const initGitRepo = async (
  cwd: string,
  dir: string,
): Promise<string | null> => {
  const git = async (...args: string[]) => {
    const out = await new Deno.Command("git", {
      args,
      cwd,
      stdout: "null",
      stderr: "piped",
    }).output();
    return { ok: out.success, err: new TextDecoder().decode(out.stderr) };
  };

  try {
    // -b needs git 2.28+; retry bare init for older ones.
    let init = await git("init", "-b", "main");
    if (!init.ok) init = await git("init");
    if (!init.ok) return summarize(init.err);

    const add = await git("add", ".");
    if (!add.ok) return summarize(add.err);

    const commit = await git(
      "commit",
      "-m",
      `Initial commit. DragonRuby v${dir}`,
    );
    if (!commit.ok) return summarize(commit.err);

    return null;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return "git not found on PATH";
    throw e;
  }
};

const summarize = (stderr: string): string =>
  stderr.trim().split("\n")[0] || "git failed";
