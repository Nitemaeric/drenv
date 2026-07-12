import { nodeRange } from "../analyze.ts";
import type { Node } from "../ruby.ts";
import type { Def, Loc, Pos } from "../types.ts";
import type { Ctx } from "./ctx.ts";

export const definition = (ctx: Ctx, uri: string, pos: Pos): Loc[] => {
  const { ws, resolver } = ctx;
  const word = resolver.wordAt(uri, pos);
  if (!word) return [];
  const local = resolver.resolveLocal(uri, pos, word);
  if (local) return [{ uri, range: nodeRange(local.node) }];
  const found = ws.defs.get(word) ?? [];

  let narrowed = found;
  if (found.length > 1) {
    // A one-hop inferred receiver type filters candidates to that class chain,
    // ahead of the enclosing-class/superclass/same-file tiers.
    const typed = receiverNarrow(ctx, uri, pos, found);
    narrowed = typed ?? resolver.contextCandidates(uri, pos, found) ?? found;
  }
  return narrowed.map(({ uri, range }) => ({ uri, range }));
};

// When `word` is the method of a call `recv.word`, type `recv` one hop and keep
// only candidates defined on that class or its superclass chain. methodsOf
// returns the same Def references stored in the index, so an identity test is
// exact. null when nothing types or the filter is empty (fall through).
const receiverNarrow = (
  ctx: Ctx,
  uri: string,
  pos: Pos,
  found: Def[],
): Def[] | null => {
  const { ws, resolver } = ctx;
  const node = ws.fileTree(uri)?.rootNode.descendantForPosition({
    row: pos.line,
    column: pos.character,
  });
  const call = node?.parent?.type === "call" &&
      node.parent.childForFieldName("method")?.id === node.id
    ? node.parent
    : null;
  const recv = call?.childForFieldName("receiver");
  if (!recv) return null;
  const cls = resolver.receiverType(uri, recv)?.class;
  if (!cls) return null;
  const chain = new Set([
    ...resolver.methodsOf(cls),
    ...resolver.methodsOf(cls, { singleton: true }),
  ]);
  const inChain = found.filter((f) => chain.has(f));
  return inChain.length > 0 ? inChain : null;
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
