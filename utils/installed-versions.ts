import { versionsPath } from "../constants.ts";

/** Compares DragonRuby `major.minor` versions numerically. */
export const compareVersions = (first: string, second: string): number => {
  const [firstMajor, firstMinor] = first.split(".").map(Number);
  const [secondMajor, secondMinor] = second.split(".").map(Number);

  if (firstMajor === secondMajor) {
    return firstMinor - secondMinor;
  }
  return firstMajor - secondMajor;
};

/** Installed version names, newest first. */
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

/** The newest installed version, or undefined when none are installed. */
export const latestInstalledVersion = async (): Promise<
  string | undefined
> => {
  return (await installedVersions())[0];
};
