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

const readIfExists = async (path: string): Promise<string> =>
  (await exists(path)) ? await Deno.readTextFile(path) : "";

export default async function changelog(version?: string) {
  const sourceDir = await latestInstalledVersion();

  if (!sourceDir) {
    throw new Error("drenv: no DragonRuby versions installed");
  }

  // DragonRuby splits its changelog across CURR (recent) and PREV (archived);
  // read both so entries for older versions still resolve.
  const base = `${versionsPath}/${sourceDir}`;
  const content = [
    await readIfExists(`${base}/CHANGELOG-CURR.txt`),
    await readIfExists(`${base}/CHANGELOG-PREV.txt`),
  ].join("\n");

  if (!content.trim()) {
    throw new Error(`drenv: changelog not found in ${base}`);
  }

  // Changelog headers use bare version numbers; strip any tier from the input.
  const target = version
    ? splitVersionInput(version).version
    : parseVersionDir(sourceDir).version;
  const entry = extractEntry(content, target);

  if (!entry) {
    throw new Error(`drenv: no changelog entry found for version ${target}`);
  }

  return entry;
}
