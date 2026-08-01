import { ensureDir, walk } from "@std/fs";
import { dirname, join, relative } from "@std/path";

// Match either path separator so the skips also work on Windows, where
// `walk()` yields backslash-separated paths.
const SKIP = [/(^|[\\/])\.DS_Store$/, /(^|[\\/])\.git([\\/]|$)/];

/**
 * Copies the contents of `src` into `dest`, skipping `.DS_Store` and `.git`.
 *
 * If `src` is a file it is copied to `dest` directly. If `src` is a directory,
 * its children are mirrored under `dest` so that `dest` becomes a copy of `src`
 * — empty directories included (DragonRuby trees carry empty sounds/, fonts/,
 * sprites/ that games expect to exist).
 *
 * Files copy one at a time. @std/fs `copy` fans the whole tree out in parallel
 * with no bound, which exhausts the process fd limit on DragonRuby version
 * trees (thousands of files under samples/ — "Too many open files").
 */
export const copyTree = async (src: string, dest: string): Promise<void> => {
  const info = await Deno.stat(src);

  if (info.isFile) {
    await ensureDir(dirname(dest));
    await Deno.copyFile(src, dest);
    return;
  }

  // Preorder walk: a directory is yielded before its contents, so ensureDir
  // has always run for a file's parent by the time the file copies.
  for await (const entry of walk(src, { skip: SKIP })) {
    const target = join(dest, relative(src, entry.path));
    if (entry.isDirectory) await ensureDir(target);
    else await Deno.copyFile(entry.path, target);
  }
};
