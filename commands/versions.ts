import { readVersion } from "../utils/read-version.ts";
import { versionsPath } from "../constants.ts";

export default async function versions() {
  const directories = (await Array.fromAsync(Deno.readDir(versionsPath)))
    .toSorted(
      (first, second) => {
        const [secondMajor, secondMinor] = second.name.split(".").map(Number);
        const [firstMajor, firstMinor] = first.name.split(".").map(Number);

        if (firstMajor == secondMajor) {
          return secondMinor - firstMinor;
        }

        return (secondMajor - firstMajor);
      },
    );

  const currentVersion = await readVersion("./CHANGELOG-CURR.txt");

  for await (const directory of directories) {
    if (directory.name == currentVersion) {
      console.log("* " + directory.name);
    } else {
      console.log("  " + directory.name);
    }
  }
}
