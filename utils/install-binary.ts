/** Writes a downloaded binary to `dest`, replacing any existing file. */
export const installBinary = async (
  body: ReadableStream<Uint8Array>,
  dest: string,
): Promise<void> => {
  if (Deno.build.os === "windows") {
    await installBinaryWindows(body, dest);
    return;
  }

  const file = await Deno.open(dest, {
    write: true,
    create: true,
    truncate: true,
  });
  await body.pipeTo(file.writable);
  await Deno.chmod(dest, 0o755);
};

/**
 * Windows cannot overwrite an executable that is currently running (os error 32).
 * Download to a staging file, rename the live binary aside, then promote the
 * staging file into place — renaming an in-use `.exe` is allowed.
 */
export const installBinaryWindows = async (
  body: ReadableStream<Uint8Array>,
  dest: string,
): Promise<void> => {
  const staging = `${dest}.new`;
  const backup = `${dest}.old`;

  const file = await Deno.open(staging, {
    write: true,
    create: true,
    truncate: true,
  });
  await body.pipeTo(file.writable);

  try {
    await Deno.remove(backup);
  } catch {
    // A prior self-update may have left a locked backup behind.
  }

  try {
    await Deno.rename(dest, backup);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }

  await Deno.rename(staging, dest);

  try {
    await Deno.remove(backup);
  } catch {
    // This process may still be executing the backed-up binary.
  }
};