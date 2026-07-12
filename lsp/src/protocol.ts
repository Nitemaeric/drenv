export type RpcMessage = {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
};

const findHeaderEnd = (buf: Uint8Array): number => {
  for (let i = 0; i + 3 < buf.length; i++) {
    if (
      buf[i] === 13 && buf[i + 1] === 10 && buf[i + 2] === 13 &&
      buf[i + 3] === 10
    ) return i;
  }
  return -1;
};

/** Content-Length framed reader; handles messages split across chunks and
 * multiple messages per chunk. Framing is done on raw bytes and only complete
 * byte ranges are decoded, so multi-byte UTF-8 straddling a chunk boundary is
 * reassembled correctly. */
export async function* readMessages(
  input: ReadableStream<Uint8Array>,
): AsyncGenerator<RpcMessage> {
  const decoder = new TextDecoder();
  let buffer = new Uint8Array(0);

  for await (const chunk of input) {
    const merged = new Uint8Array(buffer.length + chunk.length);
    merged.set(buffer);
    merged.set(chunk, buffer.length);
    buffer = merged;

    while (true) {
      const headerEnd = findHeaderEnd(buffer);
      if (headerEnd === -1) break;

      const header = decoder.decode(buffer.slice(0, headerEnd));
      const length = Number(header.match(/Content-Length: (\d+)/i)?.[1] ?? 0);
      const total = headerEnd + 4 + length;
      if (buffer.length < total) break;

      const body = decoder.decode(buffer.slice(headerEnd + 4, total));
      buffer = buffer.slice(total);
      yield JSON.parse(body) as RpcMessage;
    }
  }
}

export class Connection {
  #out: { write(p: Uint8Array): Promise<number> };
  #encoder = new TextEncoder();

  constructor(out: { write(p: Uint8Array): Promise<number> }) {
    this.#out = out;
  }

  async #send(message: unknown): Promise<void> {
    const body = this.#encoder.encode(JSON.stringify(message));
    await this.#out.write(
      this.#encoder.encode(`Content-Length: ${body.length}\r\n\r\n`),
    );
    await this.#out.write(body);
  }

  respond(id: number | string, result: unknown): Promise<void> {
    return this.#send({ jsonrpc: "2.0", id, result });
  }

  notify(method: string, params: unknown): Promise<void> {
    return this.#send({ jsonrpc: "2.0", method, params });
  }
}
