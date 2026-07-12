// drenv lsp — production entry. Wires the src/ modules over stdio; all logic
// lives in those modules (behavior reference: git history of this file).
import { fromFileUrl, resolve } from "@std/path";

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

export default async function lsp() {
  const ruby = await Ruby.init();
  const conn = new Connection(Deno.stdout);

  let ctx: Ctx | null = null;
  let dormant = false;

  const publishDiagnostics = (uri: string) =>
    conn.notify("textDocument/publishDiagnostics", {
      uri,
      diagnostics: ctx ? diagnostics(ctx, uri) : [],
    });

  const initialize = async (id: number | string, params: any) => {
    const root = params.rootUri
      ? fromFileUrl(params.rootUri)
      : params.rootPath ?? Deno.cwd();

    const roots = await detectProjectDirs(root);
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
    const indexedRoots = new Set([root, ...roots].map((p) => resolve(p)));
    await ws.scan(roots, indexedRoots);

    const resolver = new Resolver(ws);
    ctx = { ws, resolver, yard: new YardRenderer(resolver), engine };

    await conn.respond(id, {
      capabilities: {
        textDocumentSync: 1, // full
        completionProvider: { triggerCharacters: ["."] },
        signatureHelpProvider: { triggerCharacters: ["(", ","] },
        hoverProvider: true,
        definitionProvider: true,
        referencesProvider: true,
      },
      serverInfo: { name: "drenv-lsp", version: "1.0" },
    });
  };

  // Closing a buffer with an on-disk twin re-reads it (dropping the unsaved
  // overlay); a buffer with no file on disk is removed entirely — references
  // scans every fileText entry.
  const didClose = async (uri: string) => {
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

    if (dormant) {
      if (method === "exit") Deno.exit(0);
      if (method === "shutdown") return conn.respond(id!, null);
      if (id !== undefined) await conn.respond(id, null);
      return;
    }

    switch (method) {
      case "initialize":
        return initialize(id!, params);

      case "textDocument/didOpen":
        ctx?.ws.indexFile(params.textDocument.uri, params.textDocument.text);
        return publishDiagnostics(params.textDocument.uri);

      case "textDocument/didChange":
        ctx?.ws.indexFile(
          params.textDocument.uri,
          params.contentChanges[0].text,
        );
        return publishDiagnostics(params.textDocument.uri);

      case "textDocument/didClose":
        return didClose(params.textDocument.uri);

      case "textDocument/completion":
        return conn.respond(
          id!,
          ctx ? completion(ctx, params.textDocument.uri, params.position) : [],
        );

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
