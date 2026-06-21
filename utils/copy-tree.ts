import { ensureDir, walk } from "@std/fs";
import { dirname, join, relative } from "@std/path";

const SKIP = [/(^|\/)\.DS_Store$/, /(^|\/)\.git(\/|$)/];

/**
 * Copies the contents of `src` into `dest`, skipping `.DS_Store` and `.git`.
 *
 * If `src` is a file it is copied to `dest` directly. If `src` is a directory,
 * its children are mirrored under `dest` so that `dest` becomes a copy of `src`.
 */
export const copyTree = async (src: string, dest: string): Promise<void> => {
  const info = await Deno.stat(src);

  if (info.isFile) {
    await ensureDir(dirname(dest));
    await Deno.copyFile(src, dest);
    return;
  }

  for await (const entry of walk(src, { includeDirs: false, skip: SKIP })) {
    const target = join(dest, relative(src, entry.path));
    await ensureDir(dirname(target));
    await Deno.copyFile(entry.path, target);
  }
};
