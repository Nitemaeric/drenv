import { copy, exists } from "@std/fs";

import { versionsPath } from "../constants.ts";
import { latestInstalledVersion } from "../utils/installed-versions.ts";

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

export default async function update(options: { version?: string } = {}) {
  const version = options.version ?? await latestInstalledVersion();

  if (!version) {
    throw new NoVersionsInstalled();
  }

  if (!await exists(`${versionsPath}/${version}`)) {
    throw new NotInstalled(version);
  }

  const answer = prompt(`drenv: Update to version ${version}? Y/n (Y)`) ?? "";
  if (answer.trim().toLowerCase().startsWith("n")) {
    return "drenv: update cancelled";
  }

  // Copy the version's files over the current directory, preserving the game.
  for await (const item of Deno.readDir(`${versionsPath}/${version}`)) {
    if (item.name === "mygame") continue;

    await copy(
      `${versionsPath}/${version}/${item.name}`,
      `./${item.name}`,
      { overwrite: true },
    );
  }

  return `drenv: Updated to version ${version}`;
}
