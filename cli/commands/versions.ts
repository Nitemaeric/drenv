import { readVersion } from "../utils/read-version.ts";
import { versionsPath } from "../constants.ts";

export default async function versions() {
  const directories = await Deno.readDir(versionsPath);

  const currentVersion = await readVersion("./CHANGELOG-CURR.txt");

  for await (const directory of directories) {
    if (directory.name == currentVersion) {
      console.log("* " + directory.name);
    } else {
      console.log("  " + directory.name);
    }
  }
}
