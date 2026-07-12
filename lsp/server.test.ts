// server.ts is a stdio dispatch loop over closures, so it's exercised the way
// an editor would: spawn the entry as a subprocess and drive the LSP protocol.
import { assert, assertEquals } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join, toFileUrl } from "@std/path";

const MAIN_TS = join(import.meta.dirname!, "..", "main.ts");

type Session = {
  // deno-lint-ignore no-explicit-any
  request: (method: string, params: unknown) => Promise<any>;
  notify: (method: string, params: unknown) => Promise<void>;
  close: () => Promise<void>;
};

const openSession = (cwd: string): Session => {
  const proc = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", "--unstable-kv", MAIN_TS, "lsp"],
    cwd,
    stdin: "piped",
    stdout: "piped",
    stderr: "null",
  }).spawn();

  const w = proc.stdin.getWriter();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let id = 1;
  let buf = new Uint8Array(0);
  // deno-lint-ignore no-explicit-any
  const waiting = new Map<number, (r: any) => void>();

  // One write per frame: the pump replies to server->client requests without
  // awaiting, and split header/body writes from concurrent sends interleave on
  // the pipe, corrupting frames (the Windows CI flake).
  const send = async (message: unknown) => {
    const body = encoder.encode(JSON.stringify(message));
    const header = encoder.encode(`Content-Length: ${body.length}\r\n\r\n`);
    const frame = new Uint8Array(header.length + body.length);
    frame.set(header);
    frame.set(body, header.length);
    await w.write(frame);
  };

  const pump = (async () => {
    for await (const chunk of proc.stdout) {
      const merged = new Uint8Array(buf.length + chunk.length);
      merged.set(buf);
      merged.set(chunk, buf.length);
      buf = merged;
      while (true) {
        const text = decoder.decode(buf);
        const headerEnd = text.indexOf("\r\n\r\n");
        if (headerEnd === -1) break;
        const length = Number(text.match(/Content-Length: (\d+)/i)?.[1] ?? 0);
        const bodyStart = encoder.encode(text.slice(0, headerEnd + 4)).length;
        if (buf.length < bodyStart + length) break;
        const body = JSON.parse(
          decoder.decode(buf.slice(bodyStart, bodyStart + length)),
        );
        buf = buf.slice(bodyStart + length);
        if (body.id !== undefined && body.method) {
          // Server→client request (registerCapability): a good client replies.
          send({ jsonrpc: "2.0", id: body.id, result: null });
        } else if (body.id !== undefined && waiting.has(body.id)) {
          waiting.get(body.id)!(body.result);
          waiting.delete(body.id);
        }
      }
    }
  })();

  return {
    request: (method, params) => {
      const rid = id++;
      // deno-lint-ignore no-explicit-any
      const promise = new Promise<any>((resolve, reject) => {
        waiting.set(rid, resolve);
        setTimeout(() => reject(new Error(`timeout: ${method}`)), 15000);
      });
      send({ jsonrpc: "2.0", id: rid, method, params });
      return promise;
    },
    notify: (method, params) => send({ jsonrpc: "2.0", method, params }),
    close: async () => {
      await send({ jsonrpc: "2.0", method: "exit", params: null });
      try {
        w.releaseLock();
        proc.stdin.close();
      } catch { /* already closed */ }
      await proc.status;
      await pump.catch(() => {});
    },
  };
};

const beat = () => new Promise((r) => setTimeout(r, 400));

Deno.test("didChangeWatchedFiles Deleted preserves an open buffer's overlay", async () => {
  const root = await Deno.makeTempDir({ prefix: "drenv-lsp-server-" });
  try {
    await ensureDir(join(root, "mygame", "app"));
    const mainPath = join(root, "mygame", "app", "main.rb");
    // On disk: no `overlay_only` def. It exists only in the unsaved overlay.
    await Deno.writeTextFile(mainPath, "def tick args\nend\n");
    const mainUri = toFileUrl(mainPath).href;

    const sess = openSession(root);
    // deno-lint-ignore no-explicit-any
    const init: any = await sess.request("initialize", {
      processId: null,
      rootUri: toFileUrl(root).href,
      capabilities: {},
    });
    assert(
      init?.capabilities?.completionProvider,
      "fixture should activate the server, not go dormant",
    );
    await sess.notify("initialized", {});

    const OVERLAY =
      "def tick args\n  overlay_only args\nend\n\ndef overlay_only args\nend\n";
    await sess.notify("textDocument/didOpen", {
      textDocument: {
        uri: mainUri,
        languageId: "ruby",
        version: 1,
        text: OVERLAY,
      },
    });
    await beat();

    const callSite = {
      textDocument: { uri: mainUri },
      position: { line: 1, character: 4 },
    };
    // deno-lint-ignore no-explicit-any
    const before: any = await sess.request("textDocument/definition", callSite);
    assert(
      Array.isArray(before) && before.length === 1 &&
        before[0].range.start.line === 4,
      `overlay def should be indexed before the delete event (got ${
        JSON.stringify(before)
      })`,
    );

    // The file is deleted on disk while the buffer stays open. The overlay is
    // authoritative and must survive the watch event.
    await sess.notify("workspace/didChangeWatchedFiles", {
      changes: [{ uri: mainUri, type: 3 }], // 3 = Deleted
    });
    await beat();

    // deno-lint-ignore no-explicit-any
    const after: any = await sess.request("textDocument/definition", callSite);
    assert(
      Array.isArray(after) && after.length === 1 &&
        after[0].range.start.line === 4,
      `open overlay must survive a watch delete (got ${JSON.stringify(after)})`,
    );

    await sess.close();
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

Deno.test("didChangeWatchedFiles Deleted still drops a file with no open buffer", async () => {
  const root = await Deno.makeTempDir({ prefix: "drenv-lsp-server-" });
  try {
    await ensureDir(join(root, "mygame", "app"));
    await Deno.writeTextFile(
      join(root, "mygame", "app", "main.rb"),
      "def tick args\nend\n",
    );
    const extraPath = join(root, "mygame", "app", "extra.rb");
    const extraUri = toFileUrl(extraPath).href;

    const sess = openSession(root);
    // deno-lint-ignore no-explicit-any
    const init: any = await sess.request("initialize", {
      processId: null,
      rootUri: toFileUrl(root).href,
      capabilities: {},
    });
    assert(init?.capabilities?.completionProvider);
    await sess.notify("initialized", {});

    await Deno.writeTextFile(extraPath, "def freshly_added args\nend\n");
    await sess.notify("workspace/didChangeWatchedFiles", {
      changes: [{ uri: extraUri, type: 1 }], // 1 = Created
    });
    await beat();

    const defAt = {
      textDocument: { uri: extraUri },
      position: { line: 0, character: 6 },
    };
    // deno-lint-ignore no-explicit-any
    const created: any = await sess.request("textDocument/definition", defAt);
    assert(
      Array.isArray(created) && created.length === 1,
      `created file's defs should be navigable (got ${
        JSON.stringify(created)
      })`,
    );

    // Not open in any buffer: a delete event must remove it.
    await Deno.remove(extraPath).catch(() => {});
    await sess.notify("workspace/didChangeWatchedFiles", {
      changes: [{ uri: extraUri, type: 3 }], // 3 = Deleted
    });
    await beat();

    // deno-lint-ignore no-explicit-any
    const deleted: any = await sess.request("textDocument/definition", defAt);
    assertEquals(deleted, [], "deleted non-open file's defs should be gone");

    await sess.close();
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

Deno.test("$/cancelRequest is a no-op that never wedges the request stream", async () => {
  const root = await Deno.makeTempDir({ prefix: "drenv-lsp-server-" });
  try {
    await ensureDir(join(root, "mygame", "app"));
    const mainPath = join(root, "mygame", "app", "main.rb");
    await Deno.writeTextFile(mainPath, "def tick args\nend\n");
    const mainUri = toFileUrl(mainPath).href;

    const sess = openSession(root);
    // deno-lint-ignore no-explicit-any
    const init: any = await sess.request("initialize", {
      processId: null,
      rootUri: toFileUrl(root).href,
      capabilities: {},
    });
    assert(init?.capabilities?.completionProvider);
    await sess.notify("initialized", {});

    // The serialized dispatch loop means a cancel is always read after its
    // target has been answered, so it can only ever be a no-op. It must not
    // emit a reply of its own nor break the stream for later requests.
    await sess.notify("$/cancelRequest", { id: 987654 });

    // deno-lint-ignore no-explicit-any
    const def: any = await sess.request("textDocument/definition", {
      textDocument: { uri: mainUri },
      position: { line: 0, character: 4 }, // on `tick`
    });
    assert(
      Array.isArray(def) && def.length === 1,
      `request after a cancel is still answered (got ${JSON.stringify(def)})`,
    );

    await sess.close();
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

Deno.test("indexes a DragonRuby engine unpacked in the workspace", async () => {
  // A raw DragonRuby unzip: the engine's docs sit at the workspace root beside
  // mygame/, and drenv manages no copy of this version. The server must index
  // the in-workspace engine, not fall back to an empty index.
  const root = await Deno.makeTempDir({ prefix: "drenv-lsp-wsengine-" });
  try {
    await Deno.writeTextFile(join(root, "dragonruby"), ""); // project marker
    await ensureDir(join(root, "docs", "oss", "dragon"));
    // A distinctively-named method proves THIS engine was indexed (not any
    // drenv-managed version that may exist on the test machine).
    await Deno.writeTextFile(
      join(root, "docs", "oss", "dragon", "geometry.rb"),
      "module Geometry\n  def zorp_special(a, b)\n    a.x\n  end\nend\n",
    );
    await ensureDir(join(root, "mygame", "app"));
    const mainPath = join(root, "mygame", "app", "main.rb");
    const text = "def tick args\n  Geometry.\nend\n";
    await Deno.writeTextFile(mainPath, text);
    const uri = toFileUrl(mainPath).href;

    const sess = openSession(root);
    // deno-lint-ignore no-explicit-any
    const init: any = await sess.request("initialize", {
      processId: null,
      rootUri: toFileUrl(root).href,
      capabilities: {},
    });
    assert(init?.capabilities?.completionProvider);
    await sess.notify("initialized", {});
    await sess.notify("textDocument/didOpen", {
      textDocument: { uri, languageId: "ruby", version: 1, text },
    });
    await beat();

    // deno-lint-ignore no-explicit-any
    const items: any[] = await sess.request("textDocument/completion", {
      textDocument: { uri },
      position: { line: 1, character: 11 }, // after `Geometry.`
    });
    const labels = (items ?? []).map((i) => i.label);
    assert(
      labels.includes("zorp_special"),
      `in-workspace engine methods should complete (got ${
        labels.slice(0, 8).join(", ")
      })`,
    );

    await sess.close();
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});
