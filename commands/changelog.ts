import { exists } from "@std/fs";

import { versionsPath } from "../constants.ts";

const compareVersionsDesc = (first: string, second: string) => {
  const [firstMajor, firstMinor] = first.split(".").map(Number);
  const [secondMajor, secondMinor] = second.split(".").map(Number);

  if (firstMajor === secondMajor) {
    return secondMinor - firstMinor;
  }

  return secondMajor - firstMajor;
};

const findLatestInstalledVersion = async (): Promise<string | undefined> => {
  if (!await exists(versionsPath)) {
    return undefined;
  }

  const directories = await Array.fromAsync(Deno.readDir(versionsPath));

  return directories
    .filter((entry) => entry.isDirectory)
    .map((entry) => entry.name)
    .toSorted(compareVersionsDesc)[0];
};

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
  const sourceVersion = await findLatestInstalledVersion();

  if (!sourceVersion) {
    throw new Error("drenv: no DragonRuby versions installed");
  }

  const changelogPath = `${versionsPath}/${sourceVersion}/CHANGELOG-CURR.txt`;

  if (!await exists(changelogPath)) {
    throw new Error(`drenv: changelog not found at ${changelogPath}`);
  }

  const target = version ?? sourceVersion;
  const content = await Deno.readTextFile(changelogPath);
  const entry = extractEntry(content, target);

  if (!entry) {
    throw new Error(`drenv: no changelog entry found for version ${target}`);
  }

  return entry;
}
