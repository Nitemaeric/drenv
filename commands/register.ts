import { readVersion } from "../utils/read-version.ts";

export default async function register(path: string | undefined = undefined) {
  // TODO: Validate that directory is a DragonRuby installation

  const version = await readVersion(path + "/CHANGELOG-CURR.txt");

  if (!version) {
    throw new Error("drenv: DragonRuby installation is missing version");
  }

  return move(path, `${Deno.env.get("HOME")}/.drenv/versions/${version}`);
}
