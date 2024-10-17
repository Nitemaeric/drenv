import { readFirstLine } from "./read-first-line.ts";

export const readVersion = async (path: string): Promise<string> => {
  let currentVersion;

  try {
    const content = await readFirstLine(path);

    currentVersion = content.match(/[0-9\.]+/)?.[0];
  } catch (error) {}

  return currentVersion;
};
