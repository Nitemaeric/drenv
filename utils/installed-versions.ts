import { versionsPath } from "../constants.ts";
import {
  parseVersionDir,
  splitVersionInput,
  TIER_PRECEDENCE,
  tierRank,
  versionDirName,
} from "./tier.ts";

/**
 * Orders version directories: by `major.minor` first, then by tier so a richer
 * tier of the same version ranks higher (`7.11-pro` before `7.11`).
 */
export const compareVersions = (first: string, second: string): number => {
  const a = parseVersionDir(first);
  const b = parseVersionDir(second);
  const [aMajor, aMinor] = a.version.split(".").map(Number);
  const [bMajor, bMinor] = b.version.split(".").map(Number);

  if (aMajor !== bMajor) return aMajor - bMajor;
  if (aMinor !== bMinor) return aMinor - bMinor;
  return tierRank(a.tier) - tierRank(b.tier);
};

/** Installed version directory names (may carry a tier suffix), newest first. */
export const installedVersions = async (): Promise<string[]> => {
  let entries: Deno.DirEntry[] = [];

  try {
    entries = await Array.fromAsync(Deno.readDir(versionsPath));
  } catch {
    // No versions installed yet.
  }

  return entries
    .filter((entry) => entry.isDirectory)
    .map((entry) => entry.name)
    .toSorted((first, second) => compareVersions(second, first));
};

/** The newest installed version directory, or undefined when none exist. */
export const latestInstalledVersion = async (): Promise<
  string | undefined
> => {
  return (await installedVersions())[0];
};

/**
 * Resolves user input to an installed directory name against a known set.
 * Bare input (`7.11`) resolves to the highest installed tier (pro, then indie,
 * then standard); an explicit suffix (`7.11-pro`) pins the tier.
 */
export const resolveAgainst = (
  input: string,
  installed: Iterable<string>,
): string | undefined => {
  const set = installed instanceof Set ? installed : new Set(installed);
  const { version, tier } = splitVersionInput(input);

  if (tier) {
    const dir = versionDirName(version, tier);
    return set.has(dir) ? dir : undefined;
  }

  for (const candidate of TIER_PRECEDENCE) {
    const dir = versionDirName(version, candidate);
    if (set.has(dir)) return dir;
  }
  return undefined;
};

/** Resolves user input to an installed directory name, or undefined. */
export const resolveVersionDir = async (
  input: string,
): Promise<string | undefined> => {
  return resolveAgainst(input, await installedVersions());
};
