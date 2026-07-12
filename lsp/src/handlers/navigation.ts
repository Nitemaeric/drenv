import { nodeRange } from "../analyze.ts";
import type { Node } from "../ruby.ts";
import type { Loc, Pos } from "../types.ts";
import type { Ctx } from "./ctx.ts";

export const definition = (ctx: Ctx, uri: string, pos: Pos): Loc[] => {
  const { ws, resolver } = ctx;
  const word = resolver.wordAt(uri, pos);
  if (!word) return [];
  const local = resolver.resolveLocal(uri, pos, word);
  if (local) return [{ uri, range: nodeRange(local.node) }];
  const found = ws.defs.get(word) ?? [];
  const narrowed = found.length > 1
    ? resolver.contextCandidates(uri, pos, found) ?? found
    : found;
  return narrowed.map(({ uri, range }) => ({ uri, range }));
};

export const references = (ctx: Ctx, uri: string, pos: Pos): Loc[] => {
  const { ws, resolver } = ctx;
  const word = resolver.wordAt(uri, pos);
  if (!word) return [];

  // A local's references live inside its method, not across the workspace.
  const local = resolver.resolveLocal(uri, pos, word);
  let scope: { uri: string; from: number; to: number } | null = null;
  if (local) {
    let method: Node | null = local.node;
    while (
      method && method.type !== "method" && method.type !== "singleton_method"
    ) {
      method = method.parent;
    }
    if (method) {
      scope = {
        uri,
        from: method.startPosition.row,
        to: method.endPosition.row,
      };
    }
  }

  const out: Loc[] = [];
  const pattern = new RegExp(`\\b${word.replace(/[?!]/g, "\\$&")}\\b`, "g");
  for (const fileUri of ws.fileUris()) {
    if (scope && fileUri !== scope.uri) continue;
    const lines = (ws.fileText(fileUri) ?? "").split("\n");
    for (let line = 0; line < lines.length; line++) {
      if (scope && (line < scope.from || line > scope.to)) continue;
      for (const match of lines[line].matchAll(pattern)) {
        const start = match.index!;
        out.push({
          uri: fileUri,
          range: {
            start: { line, character: start },
            end: { line, character: start + word.length },
          },
        });
      }
    }
  }
  return out;
};
