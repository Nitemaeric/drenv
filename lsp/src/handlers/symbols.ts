import { nodeRange } from "../analyze.ts";
import type { Node } from "../ruby.ts";
import type { Def, Loc, Pos } from "../types.ts";
import type { Ctx } from "./ctx.ts";
import { references } from "./navigation.ts";

// LSP SymbolKind values.
const SYMBOL = {
  module: 2,
  class: 5,
  method: 6,
  property: 7,
  function: 12,
  constant: 14,
} as const;

const ATTRS = new Set(["attr_reader", "attr_writer", "attr_accessor"]);

type DocumentSymbol = {
  name: string;
  detail?: string;
  kind: number;
  range: Loc["range"];
  selectionRange: Loc["range"];
  children?: DocumentSymbol[];
};

/** The file's outline: classes and modules nesting their methods, attrs and
 * constants. Class methods (`def self.x`, `class << self`) are named `self.x`;
 * top-level methods (`tick`) are functions. */
export const documentSymbols = (ctx: Ctx, uri: string): DocumentSymbol[] => {
  const root = ctx.ws.fileTree(uri)?.rootNode;
  if (!root) return [];

  const collect = (
    node: Node,
    inNamespace: boolean,
    singleton: boolean,
  ): DocumentSymbol[] => {
    const out: DocumentSymbol[] = [];
    for (let i = 0; i < node.namedChildCount; i++) {
      const n = node.namedChild(i)!;
      const name = n.childForFieldName("name");
      if ((n.type === "class" || n.type === "module") && name) {
        out.push({
          name: name.text,
          kind: n.type === "class" ? SYMBOL.class : SYMBOL.module,
          range: nodeRange(n),
          selectionRange: nodeRange(name),
          children: collect(n, true, false),
        });
      } else if (n.type === "method" && name) {
        out.push({
          name: singleton ? `self.${name.text}` : name.text,
          kind: inNamespace ? SYMBOL.method : SYMBOL.function,
          range: nodeRange(n),
          selectionRange: nodeRange(name),
        });
      } else if (n.type === "singleton_method" && name) {
        out.push({
          name: `${n.childForFieldName("object")?.text ?? "self"}.${name.text}`,
          kind: SYMBOL.method,
          range: nodeRange(n),
          selectionRange: nodeRange(name),
        });
      } else if (n.type === "singleton_class") {
        out.push(...collect(n, inNamespace, true));
      } else if (
        n.type === "assignment" &&
        n.childForFieldName("left")?.type === "constant"
      ) {
        const left = n.childForFieldName("left")!;
        out.push({
          name: left.text,
          kind: SYMBOL.constant,
          range: nodeRange(n),
          selectionRange: nodeRange(left),
        });
      } else if (
        n.type === "call" && !n.childForFieldName("receiver") &&
        ATTRS.has(n.childForFieldName("method")?.text ?? "")
      ) {
        const args = n.childForFieldName("arguments");
        for (let j = 0; j < (args?.namedChildCount ?? 0); j++) {
          const arg = args!.namedChild(j)!;
          if (arg.type !== "simple_symbol") continue;
          const attr = arg.text.slice(1);
          out.push({
            name: singleton ? `self.${attr}` : attr,
            detail: n.childForFieldName("method")!.text,
            kind: SYMBOL.property,
            range: nodeRange(n),
            selectionRange: nodeRange(arg),
          });
        }
      } else if (n.type === "body_statement" || n.type === "ERROR") {
        out.push(...collect(n, inNamespace, singleton));
      }
    }
    return out;
  };
  return collect(root, false, false);
};

const kindOf = (d: Def): number =>
  d.kind === "class"
    ? SYMBOL.class
    : d.kind === "module"
    ? SYMBOL.module
    : d.kind === "constant"
    ? SYMBOL.constant
    : d.container
    ? SYMBOL.method
    : SYMBOL.function;

// Case-insensitive subsequence match (`plup` matches `player_update`).
const fuzzy = (query: string, name: string): boolean => {
  let i = 0;
  const q = query.toLowerCase();
  for (const ch of name.toLowerCase()) {
    if (ch === q[i]) i++;
    if (i === q.length) return true;
  }
  return q.length === 0;
};

/** Project-wide symbol search over the def index. Exact and prefix matches
 * rank ahead of fuzzy ones; the result is capped so huge vendored trees don't
 * flood the picker. */
export const workspaceSymbols = (ctx: Ctx, query: string): unknown[] => {
  const q = query.toLowerCase();
  const hits: { rank: number; name: string; def: Def }[] = [];
  for (const [name, locs] of ctx.ws.defs) {
    if (!fuzzy(q, name)) continue;
    const lower = name.toLowerCase();
    const rank = lower === q ? 0 : lower.startsWith(q) ? 1 : 2;
    for (const def of locs) hits.push({ rank, name, def });
  }
  hits.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  return hits.slice(0, 200).map(({ name, def }) => ({
    name: def.kind === "method" && def.singleton ? `self.${name}` : name,
    kind: kindOf(def),
    location: { uri: def.uri, range: def.range },
    ...(def.container ? { containerName: def.container } : {}),
  }));
};

/** Occurrences of the symbol under the cursor in this file, from the same
 * scoping as references (a local stays within its method). */
export const documentHighlight = (
  ctx: Ctx,
  uri: string,
  pos: Pos,
): unknown[] =>
  references(ctx, uri, pos)
    .filter((l) => l.uri === uri)
    .map((l) => ({ range: l.range, kind: 1 })); // Text
