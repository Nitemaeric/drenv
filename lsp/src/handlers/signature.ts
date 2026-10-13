import { extractParams } from "../analyze.ts";
import { CORE_CLASSES, selfIsSingleton } from "../resolve.ts";
import type { Node } from "../ruby.ts";
import type { ApiEntry, Def, Param, Pos } from "../types.ts";
import type { Ctx } from "./ctx.ts";

const entryFor = (
  ctx: Ctx,
  receiver: string,
  method: string,
): ApiEntry | undefined =>
  ctx.engine.api.get(receiver)?.find((e) => e.label === method);

// An argument ending exactly at the cursor is still being typed.
const before = (a: Pos, row: number, column: number): boolean =>
  row < a.line || (row === a.line && column < a.character);

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
  if (!method) return null;

  // Direct engine receiver (Geometry, args.*, …), else one-hop typed variable,
  // else a workspace method.
  let entry = receiver ? entryFor(ctx, receiver, method) : undefined;
  if (!entry && receiverNode) {
    const cls = ctx.resolver.receiverType(uri, receiverNode)?.class;
    if (cls) entry = entryFor(ctx, cls, method);
  }
  const sig = entry?.params?.length
    ? {
      label: `${receiver}.${entry.signature}`,
      doc: entry.doc,
      params: entry.params,
    }
    : workspaceSignature(ctx, uri, node, receiverNode, method);
  if (!sig) return null;

  // Active parameter: how many arguments end before the cursor; a `key:`
  // argument jumps to that keyword's parameter.
  let active = 0;
  const argsNode = node.childForFieldName("arguments");
  if (argsNode) {
    for (let i = 0; i < argsNode.namedChildCount; i++) {
      const child = argsNode.namedChild(i)!;
      if (before(pos, child.endPosition.row, child.endPosition.column)) {
        active = i + 1;
      } else {
        active = i;
        if (child.type === "pair") {
          const key = (child.childForFieldName("key") ?? child.namedChild(0))
            ?.text.replace(/:$/, "");
          const k = sig.params.findIndex((p) => p.name === key);
          if (k >= 0) active = k;
        }
        break;
      }
    }
  }

  return {
    signatures: [{
      label: sig.label,
      ...(sig.doc
        ? { documentation: { kind: "markdown", value: sig.doc } }
        : {}),
      parameters: sig.params.map((p) => ({ label: p.label })),
    }],
    activeSignature: 0,
    activeParameter: Math.min(active, sig.params.length - 1),
  };
};

// A workspace method's signature from its `def`: on the typed receiver's class
// chain (`Klass.new(` → `initialize`), or for a bare call, on self (instance or
// class context) and then the top level.
const workspaceSignature = (
  ctx: Ctx,
  uri: string,
  call: Node,
  receiverNode: Node | null,
  method: string,
): { label: string; doc?: string; params: Param[] } | null => {
  const { ws, resolver, yard } = ctx;
  let candidates: Def[];
  let name = method;
  let display: (d: Def) => string;
  const qualified = (d: Def) =>
    d.container ? `${d.container}${d.singleton ? "." : "#"}${name}` : name;

  if (receiverNode) {
    const guess = resolver.receiverType(uri, receiverNode);
    if (!guess || CORE_CLASSES.has(guess.class)) return null;
    if (method === "new" && guess.singleton) {
      name = "initialize";
      candidates = resolver.methodsOf(guess.class);
      display = () => `${guess.class}.new`;
    } else {
      candidates = resolver.methodsOf(guess.class, {
        singleton: guess.singleton,
      });
      display = qualified;
    }
  } else {
    const ns = resolver.enclosingNamespace(call);
    candidates = [
      ...(ns
        ? resolver.methodsOf(ns, { singleton: selfIsSingleton(call) })
        : []),
      ...(ws.defs.get(method) ?? []).filter((d) =>
        d.kind === "method" && !d.container
      ),
    ];
    display = qualified;
  }

  const named = new Set(ws.defs.get(name) ?? []);
  const target = candidates.find((d) => named.has(d));
  if (!target) return null;
  const def = ws.fileTree(target.uri)?.rootNode.descendantForPosition({
    row: target.range.start.line,
    column: target.range.start.character,
  })?.parent;
  if (def?.type !== "method" && def?.type !== "singleton_method") return null;
  const params = extractParams(def);
  if (params.length === 0) return null;

  return {
    label: `${display(target)}(${params.map((p) => p.label).join(", ")})`,
    doc: target.doc
      ? yard.render(target.doc, target.container ?? "")
      : undefined,
    params,
  };
};
