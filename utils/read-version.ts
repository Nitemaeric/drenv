import { readFirstLine } from "./read-first-line.ts";

export const readVersion = async (
  path: string,
): Promise<string | undefined> => {
  let currentVersion;

  try {
    const content = await readFirstLine(path);

    currentVersion = content.match(/[0-9\.]+/)?.[0];
  } catch (_error) {
    // Do nothing
  }

  return currentVersion;
};
