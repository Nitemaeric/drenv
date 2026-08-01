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

const PROJECT_GITIGNORE = `.DS_Store

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
builds/
logs/
tmp/
.dragonruby/

# Bundled DragonRuby docs and samples
docs/
samples/
`;

type NewOptions = { version?: string; skipGitignore?: boolean };

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
    await Deno.writeTextFile(`${name}/.gitignore`, PROJECT_GITIGNORE);
  }

  return `drenv: Created ${name} (${versionLabel(dir)})`;
}
