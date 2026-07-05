/**
 * Writes a downloaded binary to `dest`, replacing any existing file.
 *
 * Cannot truncate a running executable in place (Windows os error 32, Linux
 * ETXTBSY). Download to a staging file, rename the live binary aside, then
 * promote the staging file — renaming an in-use binary is allowed.
 */
export const installBinary = async (
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

  if (Deno.build.os !== "windows") {
    await Deno.chmod(staging, 0o755);
  }

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

/** @deprecated Use {@link installBinary} — kept for existing tests. */
export const installBinaryWindows = installBinary;
