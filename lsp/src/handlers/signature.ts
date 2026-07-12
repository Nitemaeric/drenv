import type { Node } from "../ruby.ts";
import type { ApiEntry, Pos } from "../types.ts";
import type { Ctx } from "./ctx.ts";

const entryFor = (
  ctx: Ctx,
  receiver: string,
  method: string,
): ApiEntry | undefined =>
  ctx.engine.api.get(receiver)?.find((e) => e.label === method);

const beforeOrAt = (a: Pos, row: number, column: number): boolean =>
  row < a.line || (row === a.line && column <= a.character);

export const signatureHelp = (ctx: Ctx, uri: string, pos: Pos): unknown => {
  const tree = ctx.ws.fileTree(uri);
  if (!tree) return null;

  let node: Node | null = tree.rootNode.descendantForPosition({
    row: pos.line,
    column: Math.max(0, pos.character - 1),
  });
  while (node && node.type !== "call") node = node.parent;
  if (!node) return null;

  const receiverNode = node.childForFieldName("receiver");
  const receiver = receiverNode?.text;
  const method = node.childForFieldName("method")?.text;
  if (!receiver || !method) return null;

  // Direct engine receiver (Geometry, args.*, …), else one-hop typed variable.
  let entry = entryFor(ctx, receiver, method);
  if (!entry && receiverNode) {
    const cls = ctx.resolver.receiverType(uri, receiverNode)?.class;
    if (cls) entry = entryFor(ctx, cls, method);
  }
  if (!entry?.params?.length) return null;

  // Active parameter: how many arguments end before the cursor.
  let active = 0;
  const argsNode = node.childForFieldName("arguments");
  if (argsNode) {
    for (let i = 0; i < argsNode.namedChildCount; i++) {
      const child = argsNode.namedChild(i)!;
      if (beforeOrAt(pos, child.endPosition.row, child.endPosition.column)) {
        active = i + 1;
      } else {
        active = i;
        break;
      }
    }
  }

  return {
    signatures: [{
      label: `${receiver}.${entry.signature}`,
      documentation: { kind: "markdown", value: entry.doc },
      parameters: entry.params.map((p) => ({ label: p.label })),
    }],
    activeSignature: 0,
    activeParameter: Math.min(active, entry.params.length - 1),
  };
};
