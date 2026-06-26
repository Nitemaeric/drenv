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

export default async function newCommand(
  name: string,
  options: { version?: string } = {},
) {
  if (options.version) {
    if (!await exists(`${versionsPath}/${options.version}`)) {
      throw new NotInstalled(options.version);
    }
    return copy(`${versionsPath}/${options.version}`, name);
  }

  return copy(`${versionsPath}/${await global()}`, name);
}
