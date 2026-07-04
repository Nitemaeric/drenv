import { ensureDir, ensureFile, move } from "@std/fs";
import { extname, resolve } from "@std/path";
import { configure, ZipReaderStream } from "@zip-js/zip-js";

import { versionsPath } from "../constants.ts";
import { versionCommand } from "../utils/version.ts";
import { validateTier, versionDirName } from "../utils/tier.ts";

configure({ useWebWorkers: false });

export default async function register(
  path: string,
  options: { tier?: string } = {},
) {
  const tier = validateTier(options.tier ?? "standard");
  const zipOrDirectory = await Deno.open(path);

  let fromZip = false;
  if (extname(path) === ".zip") {
    path = await extractZip(zipOrDirectory);
    fromZip = true;
  }

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

  // Overwrite an existing install of the same version and tier. Different tiers
  // of the same version get distinct directory names (`7.11`, `7.11-pro`), so
  // they coexist rather than clobbering each other.
  await move(path, `${versionsPath}/${dirName}`, { overwrite: true });

  // Only the zip path stages files under ./tmp; a directory register doesn't.
  if (fromZip) {
    await Deno.remove("./tmp", { recursive: true }).catch(() => {});
  }

  return `drenv: Installed ${versionDirName(version, tier)}`;
}

const extractZip = async (zip: Deno.FsFile) => {
  let directoryPath!: string;

  for await (
    const entry of zip.readable.pipeThrough(new ZipReaderStream())
  ) {
    const fullPath = resolve("./tmp/", entry.filename);

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
