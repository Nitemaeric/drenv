// drenv lsp — production entry. Wires the src/ modules over stdio; all logic
// lives in those modules (behavior reference: git history of this file).
import { basename, fromFileUrl, resolve } from "@std/path";

import { Connection, readMessages, type RpcMessage } from "./src/protocol.ts";
import { Ruby } from "./src/ruby.ts";
import { detectProjectDirs, Workspace } from "./src/workspace.ts";
import { Resolver } from "./src/resolve.ts";
import { YardRenderer } from "./src/yard.ts";
import { EngineIndex } from "./src/engine.ts";
import type { Ctx } from "./src/handlers/ctx.ts";
import { completion } from "./src/handlers/completion.ts";
import { hover } from "./src/handlers/hover.ts";
import { definition, references } from "./src/handlers/navigation.ts";
import { signatureHelp } from "./src/handlers/signature.ts";
import { diagnostics } from "./src/handlers/diagnostics.ts";
import {
  manifestCompletion,
  manifestDiagnostics,
} from "./src/handlers/manifest.ts";
import type { Pos } from "./src/types.ts";

// Only `drenv.toml` gets the manifest service; every other `.toml` is ignored,
// and toml never enters the ruby index.
const isToml = (uri: string) => uri.endsWith(".toml");
const isManifest = (uri: string) => basename(fromFileUrl(uri)) === "drenv.toml";

// Apply LSP contentChanges to a plain string (manifest buffers stay out of the
// tree-sitter overlay). JS string indices are UTF-16 code units, matching the
// LSP position encoding we negotiate.
const offsetAt = (text: string, pos: Pos): number => {
  let offset = 0;
  for (let line = 0; line < pos.line; line++) {
    const nl = text.indexOf("\n", offset);
    if (nl === -1) return text.length;
    offset = nl + 1;
  }
  return Math.min(offset + pos.character, text.length);
};

// deno-lint-ignore no-explicit-any
const applyTextChanges = (text: string, changes: any[]): string => {
  for (const change of changes) {
    if (change.range === undefined) {
      text = change.text;
      continue;
    }
    const start = offsetAt(text, change.range.start);
    const end = offsetAt(text, change.range.end);
    text = text.slice(0, start) + change.text + text.slice(end);
  }
  return text;
};

export default async function lsp() {
  const ruby = await Ruby.init();
  const conn = new Connection(Deno.stdout);

  let ctx: Ctx | null = null;
  let dormant = false;
  let roots: string[] = [];
  let indexedRoots = new Set<string>();

  // Buffers the editor holds open: their in-memory overlay wins over disk, so
  // watched-file events must not clobber them.
  const openUris = new Set<string>();

  // Open `drenv.toml` buffers, held as raw text (never the ruby index).
  const tomlDocs = new Map<string, string>();

  const publishDiagnostics = (uri: string) =>
    conn.notify("textDocument/publishDiagnostics", {
      uri,
      diagnostics: ctx ? diagnostics(ctx, uri) : [],
    });

  const publishManifest = (uri: string) =>
    conn.notify("textDocument/publishDiagnostics", {
      uri,
      diagnostics: manifestDiagnostics(tomlDocs.get(uri) ?? ""),
    });

  const initialize = async (id: number | string, params: any) => {
    const root = params.rootUri
      ? fromFileUrl(params.rootUri)
      : params.rootPath ?? Deno.cwd();

    roots = await detectProjectDirs(root);
    if (roots.length === 0) {
      dormant = true;
      await conn.respond(id, {
        capabilities: {},
        serverInfo: { name: "drenv-lsp", version: "1.0 (dormant)" },
      });
      return;
    }

    const ws = new Workspace(ruby);
    const engine = await EngineIndex.build(ruby);
    indexedRoots = new Set([root, ...roots].map((p) => resolve(p)));
    await ws.scan(roots, indexedRoots);

    const resolver = new Resolver(ws);
    ctx = { ws, resolver, yard: new YardRenderer(resolver), engine };

    const capabilities: Record<string, unknown> = {
      textDocumentSync: { openClose: true, change: 2 }, // incremental
      completionProvider: { triggerCharacters: ["."] },
      signatureHelpProvider: { triggerCharacters: ["(", ","] },
      hoverProvider: true,
      definitionProvider: true,
      referencesProvider: true,
    };
    // Our internals are UTF-16 already; only advertise it when the client asks.
    if (Array.isArray(params.capabilities?.general?.positionEncodings)) {
      capabilities.positionEncoding = "utf-16";
    }

    await conn.respond(id, {
      capabilities,
      serverInfo: { name: "drenv-lsp", version: "1.0" },
    });
  };

  // A live game project asks the client to watch the trees drenv owns, so
  // out-of-editor changes (bundle/add/update, generated files) stay indexed.
  const registerWatchers = () =>
    conn.request("client/registerCapability", {
      registrations: [{
        id: "drenv-watchers",
        method: "workspace/didChangeWatchedFiles",
        registerOptions: {
          watchers: [
            { globPattern: "**/*.rb" },
            { globPattern: "**/drenv.lock" },
            { globPattern: "**/drenv.toml" },
          ],
        },
      }],
    }).catch((e) => console.error("drenv-lsp: registerCapability failed:", e));

  const didChangeWatchedFiles = async (params: any) => {
    if (!ctx) return;
    let rescan = false;
    for (const ev of params?.changes ?? []) {
      const uri: string = ev.uri;
      const type: number = ev.type; // 1 Created, 2 Changed, 3 Deleted
      if (uri.endsWith(".rb")) {
        // An open buffer's overlay is authoritative over disk; skip every watch
        // event for it, including deletes — dropping a live overlay would leave
        // hover/completion with empty content until the next didChange.
        if (openUris.has(uri)) continue;
        if (type === 3) {
          ctx.ws.removeFile(uri);
        } else {
          try {
            ctx.ws.indexFile(uri, await Deno.readTextFile(fromFileUrl(uri)));
          } catch {
            ctx.ws.removeFile(uri);
          }
        }
      } else if (uri.endsWith("drenv.lock")) {
        rescan = true;
      } else if (isManifest(uri)) {
        // A manifest change may alter the dependency graph (re-scan), and — for
        // a drenv.toml with no open buffer — refreshes its manifest diagnostics
        // from disk. Open buffers keep their overlay and refresh via didChange.
        rescan = true;
        if (!tomlDocs.has(uri)) {
          const diagnostics = await Deno.readTextFile(fromFileUrl(uri))
            .then((t) => manifestDiagnostics(t))
            .catch(() => []);
          await conn.notify("textDocument/publishDiagnostics", {
            uri,
            diagnostics,
          });
        }
      }
    }

    if (rescan) {
      // scan() re-reads from disk, so snapshot and re-apply open overlays.
      const overlays = new Map<string, string>();
      for (const u of openUris) {
        const t = ctx.ws.fileText(u);
        if (t !== undefined) overlays.set(u, t);
      }
      await ctx.ws.scan(roots, indexedRoots);
      for (const [u, t] of overlays) ctx.ws.indexFile(u, t);
    }

    for (const u of openUris) await publishDiagnostics(u);
  };

  // Closing a buffer with an on-disk twin re-reads it (dropping the unsaved
  // overlay); a buffer with no file on disk is removed entirely — references
  // scans every fileText entry.
  const didClose = async (uri: string) => {
    openUris.delete(uri);
    if (!ctx) return;
    try {
      const text = await Deno.readTextFile(fromFileUrl(uri));
      ctx.ws.indexFile(uri, text);
    } catch {
      ctx.ws.removeFile(uri);
    }
  };

  // deno-lint-ignore no-explicit-any
  const dispatch = async (msg: RpcMessage & { params?: any }) => {
    const { id, method, params } = msg;

    if (method === "$/cancelRequest") {
      // The dispatch loop is fully serialized (`for await ... await dispatch`),
      // so by the time a $/cancelRequest is read its target has already been
      // handled and answered — there is nothing in flight left to cancel. Drop
      // it rather than tracking ids that would never be matched (an unbounded
      // leak on cancel-heavy clients).
      return;
    }

    if (dormant) {
      if (method === "exit") Deno.exit(0);
      if (method === "shutdown") return conn.respond(id!, null);
      if (id !== undefined) await conn.respond(id, null);
      return;
    }

    switch (method) {
      case "initialize":
        return initialize(id!, params);

      case "initialized":
        // Fire-and-forget: the reply routes back through handleResponse, so
        // awaiting it here would deadlock the single dispatch loop.
        if (ctx) registerWatchers();
        return;

      case "textDocument/didOpen": {
        const uri = params.textDocument.uri;
        if (isToml(uri)) {
          if (!isManifest(uri)) return; // other toml ignored silently
          tomlDocs.set(uri, params.textDocument.text);
          return publishManifest(uri);
        }
        openUris.add(uri);
        ctx?.ws.indexFile(uri, params.textDocument.text);
        return publishDiagnostics(uri);
      }

      case "textDocument/didChange": {
        const uri = params.textDocument.uri;
        const changes = params.contentChanges;
        if (isToml(uri)) {
          if (!isManifest(uri)) return;
          tomlDocs.set(uri, applyTextChanges(tomlDocs.get(uri) ?? "", changes));
          return publishManifest(uri);
        }
        if (ctx) {
          if (changes.length === 1 && changes[0].range === undefined) {
            ctx.ws.indexFile(uri, changes[0].text); // full-text fallback
          } else {
            ctx.ws.applyEdits(uri, changes);
          }
        }
        return publishDiagnostics(uri);
      }

      case "textDocument/didClose": {
        const uri = params.textDocument.uri;
        if (isToml(uri)) {
          if (tomlDocs.delete(uri)) {
            await conn.notify("textDocument/publishDiagnostics", {
              uri,
              diagnostics: [],
            });
          }
          return;
        }
        return didClose(uri);
      }

      case "workspace/didChangeWatchedFiles":
        return didChangeWatchedFiles(params);

      case "textDocument/completion": {
        const uri = params.textDocument.uri;
        if (isToml(uri)) {
          return conn.respond(
            id!,
            isManifest(uri)
              ? manifestCompletion(tomlDocs.get(uri) ?? "", params.position)
              : [],
          );
        }
        return conn.respond(
          id!,
          ctx ? completion(ctx, uri, params.position) : [],
        );
      }

      case "textDocument/signatureHelp":
        return conn.respond(
          id!,
          ctx
            ? signatureHelp(ctx, params.textDocument.uri, params.position)
            : null,
        );

      case "textDocument/hover":
        return conn.respond(
          id!,
          ctx ? hover(ctx, params.textDocument.uri, params.position) : null,
        );

      case "textDocument/definition":
        return conn.respond(
          id!,
          ctx ? definition(ctx, params.textDocument.uri, params.position) : [],
        );

      case "textDocument/references":
        return conn.respond(
          id!,
          ctx ? references(ctx, params.textDocument.uri, params.position) : [],
        );

      case "shutdown":
        return conn.respond(id!, null);

      case "exit":
        Deno.exit(0);
        break;

      default:
        if (id !== undefined) await conn.respond(id, null);
    }
  };

  for await (const msg of readMessages(Deno.stdin.readable)) {
    // A response (id, no method) settles a server→client request; never dispatch.
    if (msg.method === undefined && msg.id !== undefined) {
      conn.handleResponse(msg);
      continue;
    }
    try {
      await dispatch(msg);
    } catch (error) {
      console.error("drenv-lsp:", error instanceof Error ? error.stack : error);
      // A handler crash must never kill the server; requests still get a reply.
      if (msg.id !== undefined) {
        await conn.respond(msg.id, null).catch(() => {});
      }
    }
  }
}
