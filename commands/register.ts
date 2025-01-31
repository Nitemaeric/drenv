import { ensureDir, ensureFile, exists, move } from "@std/fs";
import { extname, resolve } from "@std/path";
import { configure, ZipReaderStream } from "@zip-js/zip-js";

import { versionsPath } from "../constants.ts";
import { versionCommand } from "../utils/version.ts";

configure({ useWebWorkers: false });

export default async function register(path: string) {
  const zipOrDirectory = await Deno.open(path);

  if (extname(path) === ".zip") {
    path = await extractZip(zipOrDirectory);
  }

  const directory = await Deno.open(path);
  const directoryInfo = await directory.stat();

  if (!directoryInfo.isDirectory) {
    throw new Error(
      "drenv: <path> must be a directory with the dragonruby executable or a zip file",
    );
  }

  const version = await versionCommand(path);

  await ensureDir(versionsPath);

  if (await exists(`${versionsPath}/${version}`)) {
    throw new Error(
      `drenv: ${version} is already installed`,
    );
  }

  await move(path, `${versionsPath}/${version}`);

  await Deno.remove("./tmp", { recursive: true });

  return `drenv: Installed ${version}`;
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

    if (entry.executable) {
      await Deno.chmod(fullPath, 0o755);
    }
  }

  return directoryPath;
};
