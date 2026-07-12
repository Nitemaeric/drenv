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
      let message: RpcMessage;
      try {
        message = JSON.parse(body) as RpcMessage;
      } catch (error) {
        // A malformed frame (bad JSON, or an empty body from a missing/zero
        // Content-Length) must not kill the reader — skip it and stay framed.
        console.error("drenv-lsp: dropping malformed message:", error);
        continue;
      }
      yield message;
    }
  }
}

export class Connection {
  #out: { write(p: Uint8Array): Promise<number> };
  #encoder = new TextEncoder();
  // Serializes writes: server→client requests are fired without awaiting, so
  // two frames could otherwise interleave header/body on the wire.
  #writeQueue: Promise<void> = Promise.resolve();
  #nextRequestId = 0;
  #pending = new Map<
    number | string,
    { resolve: (r: unknown) => void; reject: (e: unknown) => void }
  >();

  constructor(out: { write(p: Uint8Array): Promise<number> }) {
    this.#out = out;
  }

  #send(message: unknown): Promise<void> {
    const body = this.#encoder.encode(JSON.stringify(message));
    const header = this.#encoder.encode(
      `Content-Length: ${body.length}\r\n\r\n`,
    );
    const task = this.#writeQueue.then(async () => {
      await this.#out.write(header);
      await this.#out.write(body);
    });
    this.#writeQueue = task.catch(() => {});
    return task;
  }

  respond(id: number | string, result: unknown): Promise<void> {
    return this.#send({ jsonrpc: "2.0", id, result });
  }

  error(id: number | string, code: number, message: string): Promise<void> {
    return this.#send({ jsonrpc: "2.0", id, error: { code, message } });
  }

  notify(method: string, params: unknown): Promise<void> {
    return this.#send({ jsonrpc: "2.0", method, params });
  }

  /** Server→client request. The read loop must feed replies back through
   * `handleResponse`; the returned promise must never be awaited inside the
   * dispatch loop (that would deadlock — the reply arrives on the same loop). */
  request(method: string, params: unknown): Promise<unknown> {
    const id = `srv-${this.#nextRequestId++}`;
    const promise = new Promise<unknown>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
    });
    this.#send({ jsonrpc: "2.0", id, method, params }).catch((e) => {
      this.#pending.get(id)?.reject(e);
      this.#pending.delete(id);
    });
    return promise;
  }

  /** Resolves a pending server→client request from an incoming response.
   * Returns true when the id matched one of ours (so the loop skips dispatch). */
  handleResponse(msg: RpcMessage): boolean {
    if (msg.id === undefined) return false;
    const p = this.#pending.get(msg.id);
    if (!p) return false;
    this.#pending.delete(msg.id);
    const err = (msg as { error?: unknown }).error;
    if (err !== undefined) p.reject(err);
    else p.resolve(msg.result);
    return true;
  }
}
