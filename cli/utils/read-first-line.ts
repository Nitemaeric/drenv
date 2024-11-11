export const readFirstLine = async (path: string) => {
  const file = await Deno.open(path);

  const buffer = new Uint8Array(1);
  const decoder = new TextDecoder();
  let content = "";

  while (decoder.decode(buffer) != "\n") {
    await file.read(buffer);

    content += decoder.decode(buffer);
  }

  return content;
};
