import { ensureDir } from "@std/fs";

import { homePath } from "../constants.ts";

/** Creates a temp directory under `~/.drenv` (same filesystem as installs). */
export const makeDrenvTempDir = async (prefix: string): Promise<string> => {
  await ensureDir(homePath);
  return await Deno.makeTempDir({ prefix, dir: homePath });
};