import type { Node } from "./ruby.ts";
import type { ConstResolver, Def, Pos } from "./types.ts";
import type { Workspace } from "./workspace.ts";

export type LocalHit = {
  role: "parameter" | "block parameter" | "local variable";
  node: Node;
  method: Node;
  methodLabel: string;
};

export class Resolver implements ConstResolver {
  #ws: Workspace;
  #nsIndex = new Map<string, Def>();
  #nsGeneration = -1;

  constructor(ws: Workspace) {
    this.#ws = ws;
  }

  wordAt(uri: string, pos: Pos): string | null {
    const text = this.#ws.fileText(uri) ?? "";
    const line = text.split("\n")[pos.line] ?? "";
    const before = line.slice(0, pos.character).match(/[\w?!]*$/)?.[0] ?? "";
    const after = line.slice(pos.character).match(/^[\w?!]*/)?.[0] ?? "";
    const word = before + after;
    return word || null;
  }

  enclosingNamespace(n: Node): string {
    const parts: string[] = [];
    for (let p = n.parent; p; p = p.parent) {
      if (p.type === "class" || p.type === "module") {
        const name = p.childForFieldName("name")?.text;
        if (name) parts.unshift(name);
      }
    }
    return parts.join("::");
  }

  /** When the identifier at `pos` is a parameter, block parameter, or local
   * variable of its enclosing method, workspace-wide name matches are noise —
   * resolve it locally instead. */
  resolveLocal(uri: string, pos: Pos, word: string): LocalHit | null {
    const tree = this.#ws.fileTree(uri);
    if (!tree) return null;
    const node = tree.rootNode.descendantForPosition({
      row: pos.line,
      column: pos.character,
    });
    if (!node || node.type !== "identifier" || node.text !== word) return null;
    if (
      node.parent?.type === "call" &&
      node.parent.childForFieldName("method")?.id === node.id
    ) {
      return null;
    }

    let method: Node | null = null;
    for (let p = node.parent; p; p = p.parent) {
      if (p.type === "method" || p.type === "singleton_method") {
        method = p;
        break;
      }
    }
    if (!method) return null;

    const methodName = method.childForFieldName("name")?.text ?? "?";
    const ns = this.enclosingNamespace(method);
    const methodLabel = ns ? `${ns}#${methodName}` : methodName;
    const nameOf = (child: Node): Node | null =>
      child.type === "identifier" ? child : child.childForFieldName("name");

    const params = method.childForFieldName("parameters");
    if (params) {
      for (let i = 0; i < params.namedChildCount; i++) {
        const name = nameOf(params.namedChild(i)!);
        if (name?.text === word) {
          return { role: "parameter", node: name, method, methodLabel };
        }
      }
    }

    let hit: LocalHit | null = null;
    const scan = (n: Node) => {
      if (hit) return;
      if (n.type === "block_parameters") {
        for (let i = 0; i < n.namedChildCount; i++) {
          const name = nameOf(n.namedChild(i)!);
          if (name?.text === word) {
            hit = {
              role: "block parameter",
              node: name,
              method: method!,
              methodLabel,
            };
            return;
          }
        }
      }
      if (n.type === "assignment") {
        const left = n.childForFieldName("left");
        if (left?.type === "identifier" && left.text === word) {
          hit = {
            role: "local variable",
            node: left,
            method: method!,
            methodLabel,
          };
          return;
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) scan(n.namedChild(i)!);
    };
    scan(method);
    return hit;
  }

  /** Qualified class/module name -> Def, rebuilt when the def index moves. */
  namespaceIndex(): Map<string, Def> {
    if (this.#nsGeneration === this.#ws.generation) return this.#nsIndex;
    this.#nsIndex = new Map();
    for (const [name, locs] of this.#ws.defs) {
      for (const loc of locs) {
        if (loc.kind === "method" || !loc.kind) continue;
        const qualified = loc.container ? `${loc.container}::${name}` : name;
        if (!this.#nsIndex.has(qualified)) this.#nsIndex.set(qualified, loc);
      }
    }
    this.#nsGeneration = this.#ws.generation;
    return this.#nsIndex;
  }

  /** Resolves a constant path the way Ruby/YARD would: relative to the doc's
   * namespace first, walking outward, then top-level. */
  resolveConstName(path: string, container: string): string | null {
    const ns = this.namespaceIndex();
    const parts = container ? container.split("::") : [];
    for (let i = parts.length; i >= 0; i--) {
      const prefix = parts.slice(0, i).join("::");
      const key = prefix ? `${prefix}::${path}` : path;
      if (ns.has(key)) return key;
    }
    return null;
  }

  resolveConst(path: string, container: string): Def | null {
    const key = this.resolveConstName(path, container);
    return key ? this.namespaceIndex().get(key) ?? null : null;
  }

  /** Ranks a bare call's candidate definitions by the call site's enclosing
   * class, its superclass chain, then same-file — Ruby's own lookup order,
   * approximately. */
  contextCandidates(uri: string, pos: Pos, found: Def[]): Def[] | null {
    const tree = this.#ws.fileTree(uri);
    const node = tree?.rootNode.descendantForPosition({
      row: pos.line,
      column: pos.character,
    });
    if (!node) return null;

    let ns = this.enclosingNamespace(node);
    const seen = new Set<string>();
    while (ns && !seen.has(ns)) {
      seen.add(ns);
      const hits = found.filter((f) => f.container === ns);
      if (hits.length > 0) return hits;
      const cls = this.namespaceIndex().get(ns);
      ns = cls?.superclass
        ? this.resolveConstName(
          cls.superclass,
          ns.split("::").slice(0, -1).join("::"),
        ) ?? ""
        : "";
    }

    const inFile = found.filter((f) => f.uri === uri);
    return inFile.length > 0 ? inFile : null;
  }
}
