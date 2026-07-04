export const readFirstLine = async (path: string) => {
  const file = await Deno.open(path);

  try {
    const buffer = new Uint8Array(1);
    const decoder = new TextDecoder();
    let content = "";

    while (true) {
      const read = await file.read(buffer);
      if (read === null) break; // EOF — file has no trailing newline

      const char = decoder.decode(buffer.subarray(0, read));
      if (char === "\n") break;

      content += char;
    }

    return content;
  } finally {
    file.close();
  }
};
