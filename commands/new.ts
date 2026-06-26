import { copy, exists } from "@std/fs";

import { versionsPath } from "../constants.ts";

import global from "./global.ts";

export class NotInstalled extends Error {
  version: string;

  constructor(version: string) {
    super(`drenv: version '${version}' not installed`);

    this.name = "NotInstalled";
    this.version = version;
  }
}

const PROJECT_GITIGNORE = `.DS_Store

# DragonRuby binaries (re-added by drenv new / drenv update)
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
  if (options.version) {
    if (!await exists(`${versionsPath}/${options.version}`)) {
      throw new NotInstalled(options.version);
    }
    await copy(`${versionsPath}/${options.version}`, name);
  } else {
    await copy(`${versionsPath}/${await global()}`, name);
  }

  if (!options.skipGitignore) {
    await Deno.writeTextFile(`${name}/.gitignore`, PROJECT_GITIGNORE);
  }
}
