import { exists } from "jsr:@std/fs";

import { homePath, versionsPath } from "../constants.ts";

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

export default async function global(version: string | undefined = undefined) {
  if (version) {
    return setGlobalVersion(version);
  } else {
    return getGlobalVersion();
  }
}

const setGlobalVersion = async (version: string) => {
  if (!await exists(`${versionsPath}/${version}`)) {
    throw new NotInstalled(version);
  }

  return Deno.writeTextFile(`${homePath}/.dragonruby-version`, version);
};

const getGlobalVersion = async () => {
  if (!await exists(`${homePath}/.dragonruby-version`)) {
    throw new NoGlobalVersion();
  }

  return Deno.readTextFile(`${homePath}/.dragonruby-version`);
};
