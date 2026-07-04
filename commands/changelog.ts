import { exists } from "@std/fs";

import { versionsPath } from "../constants.ts";
import { latestInstalledVersion } from "../utils/installed-versions.ts";
import { parseVersionDir, splitVersionInput } from "../utils/tier.ts";

const extractEntry = (
  changelog: string,
  version: string,
): string | undefined => {
  const lines = changelog.split("\n");
  const escapedVersion = version.replace(/\./g, "\\.");
  const headerPattern = new RegExp(`^\\* ${escapedVersion}\\s*$`);

  const startIndex = lines.findIndex((line) => headerPattern.test(line));

  if (startIndex === -1) {
    return undefined;
  }

  let endIndex = lines.length;
  for (let index = startIndex + 1; index < lines.length; index++) {
    if (/^\* \d/.test(lines[index])) {
      endIndex = index;
      break;
    }
  }

  return lines.slice(startIndex, endIndex).join("\n").trimEnd();
};

export default async function changelog(version?: string) {
  const sourceDir = await latestInstalledVersion();

  if (!sourceDir) {
    throw new Error("drenv: no DragonRuby versions installed");
  }

  const changelogPath = `${versionsPath}/${sourceDir}/CHANGELOG-CURR.txt`;

  if (!await exists(changelogPath)) {
    throw new Error(`drenv: changelog not found at ${changelogPath}`);
  }

  // Changelog headers use bare version numbers; strip any tier from the input.
  const target = version
    ? splitVersionInput(version).version
    : parseVersionDir(sourceDir).version;
  const content = await Deno.readTextFile(changelogPath);
  const entry = extractEntry(content, target);

  if (!entry) {
    throw new Error(`drenv: no changelog entry found for version ${target}`);
  }

  return entry;
}
