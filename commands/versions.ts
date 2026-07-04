import { readVersion } from "../utils/read-version.ts";
import { getLatestAvailableVersion } from "../utils/latest-version.ts";
import {
  compareVersions,
  installedVersions,
} from "../utils/installed-versions.ts";
import { parseVersionDir, versionLabel } from "../utils/tier.ts";

export default async function versions() {
  const directories = await installedVersions();

  // The project only records a bare version number, so mark every tier of it.
  const currentVersion = await readVersion("./CHANGELOG-CURR.txt");

  for (const name of directories) {
    const marker = parseVersionDir(name).version === currentVersion
      ? "* "
      : "  ";
    console.log(marker + versionLabel(name));
  }

  const latestAvailable = await getLatestAvailableVersion();
  const latestInstalled = directories[0];

  if (
    latestAvailable && latestInstalled &&
    compareVersions(latestAvailable, latestInstalled) > 0
  ) {
    console.log(
      `v${latestAvailable} is available. \`drenv install\` to install`,
    );
  }
}
