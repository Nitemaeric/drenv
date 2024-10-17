import { copy, exists } from "jsr:@std/fs";

import { readVersion } from "../utils/read-version.ts";

export class NotInstalled extends Error {
  version: string;

  constructor(version: string) {
    super(`drenv: version '${version}' not installed`);

    this.name = "NotInstalled";
    this.version = version;
  }
}

export default async function local(version: string | undefined = undefined) {
  if (version) {
    return setLocalVersion(version);
  } else {
    return getLocalVersion();
  }
}

const setLocalVersion = async (version: string) => {
  const sourceDirectory = `${Deno.env.get("HOME")}/.drenv/versions/${version}`;

  if (!await exists(sourceDirectory)) {
    throw new NotInstalled(version);
  }

  const items = await Deno.readDir(sourceDirectory);

  for await (const item of items) {
    if (item.name == "mygame") {
      continue;
    }

    await copy(sourceDirectory + "/" + item.name, "./" + item.name, {
      overwrite: true,
    });
  }
};

const getLocalVersion = async () => {
  return readVersion("./CHANGELOG-CURR.txt");
};
