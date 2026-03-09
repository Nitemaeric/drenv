import { copy, exists } from "@std/fs";

import { readVersion } from "../utils/read-version.ts";
import { versionsPath } from "../constants.ts";

export class NotInstalled extends Error {
  version: string;

  constructor(version: string) {
    super(`drenv: version '${version}' not installed`);

    this.name = "NotInstalled";
    this.version = version;
  }
}

export default function local(version: string | undefined = undefined) {
  if (version) {
    return setLocalVersion(version);
  } else {
    return getLocalVersion();
  }
}

const setLocalVersion = async (version: string) => {
  const sourceDirectory = `${versionsPath}/${version}`;

  if (!await exists(sourceDirectory)) {
    throw new NotInstalled(version);
  }

  const items = Deno.readDir(sourceDirectory);

  for await (const item of items) {
    if (item.name == "mygame") {
      continue;
    }

    await copy(sourceDirectory + "/" + item.name, "./" + item.name, {
      overwrite: true,
    });
  }
};

const getLocalVersion = () => {
  return readVersion("./CHANGELOG-CURR.txt");
};
