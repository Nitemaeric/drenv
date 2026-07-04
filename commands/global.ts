import { exists } from "@std/fs";

import { homePath } from "../constants.ts";
import { resolveVersionDir } from "../utils/installed-versions.ts";

export class NotInstalled extends Error {
  version: string;

  constructor(version: string) {
    super(`drenv: version '${version}' not installed`);

    this.name = "NotInstalled";
    this.version = version;
  }
}

export class NoGlobalVersion extends Error {
  constructor() {
    super("drenv: no global version configured");
    this.name = "NoGlobalVersion";
  }
}

export default function global(version: string | undefined = undefined) {
  if (version) {
    return setGlobalVersion(version);
  } else {
    return getGlobalVersion();
  }
}

const setGlobalVersion = async (version: string) => {
  // Bare input (`7.11`) resolves to standard, then pro, then indie; an explicit
  // suffix (`7.11-pro`) pins the tier. Store the resolved directory name.
  const resolved = await resolveVersionDir(version);
  if (!resolved) {
    throw new NotInstalled(version);
  }

  return Deno.writeTextFile(`${homePath}/.dragonruby-version`, resolved);
};

const getGlobalVersion = async () => {
  if (!await exists(`${homePath}/.dragonruby-version`)) {
    throw new NoGlobalVersion();
  }

  return Deno.readTextFile(`${homePath}/.dragonruby-version`);
};
