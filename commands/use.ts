import { copy } from "@std/fs";

import { versionsPath } from "../constants.ts";
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

export class NoVersionsInstalled extends Error {
  constructor() {
    super("drenv: no versions installed — run `drenv install` first");
    this.name = "NoVersionsInstalled";
  }
}

export default async function use(version?: string) {
  let dir: string | undefined;
  if (version) {
    dir = await resolveVersionDir(version);
    if (!dir) {
      throw new NotInstalled(version);
    }
  } else {
    dir = await latestInstalledVersion();
    if (!dir) {
      throw new NoVersionsInstalled();
    }
  }

  const label = versionLabel(dir);
  const answer = prompt(`drenv: Use version ${label}? Y/n (Y)`) ?? "";
  if (answer.trim().toLowerCase().startsWith("n")) {
    return "drenv: cancelled";
  }

  // Copy the version's files over the current directory, preserving the game.
  for await (const item of Deno.readDir(`${versionsPath}/${dir}`)) {
    if (item.name === "mygame") continue;

    await copy(
      `${versionsPath}/${dir}/${item.name}`,
      `./${item.name}`,
      { overwrite: true },
    );
  }

  return `drenv: Now using version ${label}`;
}
