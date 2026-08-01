import { versionsPath } from "../constants.ts";
import { copyTree } from "../utils/copy-tree.ts";
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

// Both templates follow the engine's own guidance in
// docs/guides/starting-a-new-project.md: a public repo must not redistribute
// the engine; a private/commercial repo commits everything — engine, docs/,
// samples/, builds/ — so the game keeps working with its exact engine version.
const PUBLIC_GITIGNORE = `.DS_Store

# DragonRuby binaries (re-added by drenv new / drenv use)
dragonruby
dragonruby.exe
dragonruby-publish
dragonruby-publish.exe
dragonruby-bind
dragonruby-bind.exe
dragonruby-firestarter
dragonruby-httpd

# Build and runtime artifacts
/tmp/
/builds/
/logs/
/.dragonruby/

# Bundled DragonRuby docs and samples
/docs/
/samples/
`;

const PRIVATE_GITIGNORE = `.DS_Store

# Runtime artifacts. Everything else — engine binaries, docs/, samples/,
# builds/ — is committed, per DragonRuby's guidance for private repos.
/tmp/
/logs/
`;

type NewOptions = {
  version?: string;
  skipGitignore?: boolean;
  skipGit?: boolean;
};

export default async function newCommand(
  name: string,
  options: NewOptions = {},
) {
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
    let template = PUBLIC_GITIGNORE;
    if (!options.skipGit) {
      const answer = prompt("drenv: Will this be a public repository? y/N (N)");
      const isPublic = (answer ?? "").trim().toLowerCase().startsWith("y");
      template = isPublic ? PUBLIC_GITIGNORE : PRIVATE_GITIGNORE;
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
