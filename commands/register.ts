import { ensureDir, move } from "jsr:@std/fs";

import { readVersion } from "../utils/read-version.ts";
import { versionsPath } from "../constants.ts";

export default async function register(path: string) {
  // TODO: Validate that directory is a DragonRuby installation

  const version = await readVersion(path + "/CHANGELOG-CURR.txt");

  if (!version) {
    throw new Error("drenv: DragonRuby installation is missing version");
  }

  await ensureDir(versionsPath);

  return move(path, `${versionsPath}/${version}`);
}
