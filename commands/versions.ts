import { readVersion } from "../utils/read-version.ts";
import { getLatestAvailableVersion } from "../utils/latest-version.ts";
import { versionsPath } from "../constants.ts";

const compareVersions = (first: string, second: string) => {
  const [firstMajor, firstMinor] = first.split(".").map(Number);
  const [secondMajor, secondMinor] = second.split(".").map(Number);

  if (firstMajor === secondMajor) {
    return firstMinor - secondMinor;
  }

  return firstMajor - secondMajor;
};

export default async function versions() {
  const directories = (await Array.fromAsync(Deno.readDir(versionsPath)))
    .toSorted((first, second) => compareVersions(second.name, first.name));

  const currentVersion = await readVersion("./CHANGELOG-CURR.txt");

  for await (const directory of directories) {
    if (directory.name == currentVersion) {
      console.log("* " + directory.name);
    } else {
      console.log("  " + directory.name);
    }
  }

  const latestAvailable = await getLatestAvailableVersion();
  const latestInstalled = directories[0]?.name;

  if (
    latestAvailable && latestInstalled &&
    compareVersions(latestAvailable, latestInstalled) > 0
  ) {
    console.log(
      `v${latestAvailable} is available. \`drenv install\` to install`,
    );
  }
}
