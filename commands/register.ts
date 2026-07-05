import { ensureDir, ensureFile, move } from "@std/fs";
import { extname, resolve } from "@std/path";
import { configure, ZipReaderStream } from "@zip-js/zip-js";

import { versionsPath } from "../constants.ts";
import { makeDrenvTempDir } from "../utils/temp.ts";
import { versionCommand } from "../utils/version.ts";
import { validateTier, versionDirName } from "../utils/tier.ts";

configure({ useWebWorkers: false });

export default async function register(
  path: string,
  options: { tier?: string } = {},
) {
  const tier = validateTier(options.tier ?? "standard");
  const zipOrDirectory = await Deno.open(path);

  // Zips are extracted into a throwaway temp directory (not the cwd) and cleaned
  // up afterward. A directory register moves the given path in place.
  let extractDir: string | undefined;
  if (extname(path) === ".zip") {
    extractDir = await makeDrenvTempDir("drenv-register-");
    path = await extractZip(zipOrDirectory, extractDir);
  }

  try {
    const directory = await Deno.open(path);
    const directoryInfo = await directory.stat();

    if (!directoryInfo.isDirectory) {
      throw new Error(
        "drenv: <path> must be a directory with the dragonruby executable or a zip file",
      );
    }

    const version = await versionCommand(path);
    const dirName = versionDirName(version, tier);

    await ensureDir(versionsPath);

    // Overwrite an existing install of the same version and tier. Different
    // tiers of the same version get distinct directory names (`7.11`,
    // `7.11-pro`), so they coexist rather than clobbering each other.
    await move(path, `${versionsPath}/${dirName}`, { overwrite: true });

    return `drenv: Installed ${dirName}`;
  } finally {
    if (extractDir) {
      await Deno.remove(extractDir, { recursive: true }).catch(() => {});
    }
  }
}

const extractZip = async (zip: Deno.FsFile, baseDir: string) => {
  let directoryPath!: string;

  for await (
    const entry of zip.readable.pipeThrough(new ZipReaderStream())
  ) {
    const fullPath = resolve(baseDir, entry.filename);

    if (entry.directory) {
      directoryPath ??= fullPath;

      await ensureDir(fullPath);

      continue;
    }

    await ensureFile(fullPath);

    await entry.readable?.pipeTo((await Deno.create(fullPath)).writable);

    if (entry.executable && Deno.build.os !== "windows") {
      await Deno.chmod(fullPath, 0o755);
    }
  }

  return directoryPath;
};
