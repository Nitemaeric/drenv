import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";

import { Connection, readMessages, type RpcMessage } from "./protocol.ts";

const enc = new TextEncoder();

const frame = (msg: unknown): Uint8Array => {
  const body = enc.encode(JSON.stringify(msg));
  const header = enc.encode(`Content-Length: ${body.length}\r\n\r\n`);
  const out = new Uint8Array(header.length + body.length);
  out.set(header);
  out.set(body, header.length);
  return out;
};

const concat = (parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

const streamOf = (chunks: Uint8Array[]): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });

const collect = async (
  stream: ReadableStream<Uint8Array>,
): Promise<RpcMessage[]> => {
  const out: RpcMessage[] = [];
  for await (const msg of readMessages(stream)) out.push(msg);
  return out;
};

describe("readMessages", () => {
  it("reassembles one message split across multiple chunks", async () => {
    const msg: RpcMessage = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    };
    const bytes = frame(msg);
    const chunks = [
      bytes.slice(0, 4),
      bytes.slice(4, 9),
      bytes.slice(9, 20),
      bytes.slice(20),
    ];
    assertEquals(await collect(streamOf(chunks)), [msg]);
  });

  it("yields several messages delivered in a single chunk", async () => {
    const msgs: RpcMessage[] = [
      { jsonrpc: "2.0", id: 1, method: "a", params: { n: 1 } },
      { jsonrpc: "2.0", method: "b", params: { n: 2 } },
      { jsonrpc: "2.0", id: 3, result: "ok" },
    ];
    const single = concat(msgs.map(frame));
    assertEquals(await collect(streamOf([single])), msgs);
  });

  it("reassembles multi-byte UTF-8 straddling a chunk boundary", async () => {
    // "🐉" is 4 bytes, "é" is 2 bytes — both must survive being cut in half.
    const msg: RpcMessage = {
      jsonrpc: "2.0",
      id: 7,
      params: { text: "🐉 café ☃" },
    };
    const bytes = frame(msg);

    // Deterministic split mid the trailing "☃" (3 bytes).
    const cut = bytes.length - 3;
    assertEquals(
      await collect(streamOf([bytes.slice(0, cut), bytes.slice(cut)])),
      [msg],
    );

    // Every possible boundary must decode identically.
    for (let i = 1; i < bytes.length; i++) {
      assertEquals(
        await collect(streamOf([bytes.slice(0, i), bytes.slice(i)])),
        [msg],
      );
    }
  });
});

describe("Connection", () => {
  it("frames responses and notifications readMessages can parse back", async () => {
    const written: Uint8Array[] = [];
    const conn = new Connection({
      write(p) {
        written.push(p.slice());
        return Promise.resolve(p.length);
      },
    });

    await conn.respond(1, { capabilities: {} });
    await conn.notify("textDocument/publishDiagnostics", { uri: "file:///a" });

    const expected: RpcMessage[] = [
      { jsonrpc: "2.0", id: 1, result: { capabilities: {} } },
      {
        jsonrpc: "2.0",
        method: "textDocument/publishDiagnostics",
        params: { uri: "file:///a" },
      },
    ];
    assertEquals(await collect(streamOf([concat(written)])), expected);
  });
});
