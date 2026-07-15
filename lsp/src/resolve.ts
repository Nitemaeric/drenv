import type { Node } from "./ruby.ts";
import type { ConstResolver, Def, Pos } from "./types.ts";
import type { Workspace } from "./workspace.ts";

export type LocalHit = {
  role: "parameter" | "block parameter" | "local variable";
  node: Node;
  method: Node;
  methodLabel: string;
};

/** One resolved receiver type and the rule that produced it. `source` gates the
 * diagnostics extension (only `"literal"` may drive a new warning). `keys` are
 * the symbol keys of a hash literal the receiver was assigned — DragonRuby
 * patches Hash so `h.foo` reads `h[:foo]`, so they complete as members. */
export type TypeGuess = {
  class: string;
  source: "literal" | "new" | "ivar" | "return";
  keys?: string[];
};

// Literal RHS node type -> the core class it constructs. Numeric literals both
// collapse to "Numeric" (the receiver key the engine's core tables use).
const LITERAL_CLASS: Record<string, string> = {
  array: "Array",
  hash: "Hash",
  string: "String",
  integer: "Numeric",
  float: "Numeric",
  simple_symbol: "Symbol",
};

export const CORE_CLASSES: ReadonlySet<string> = new Set(
  Object.values(LITERAL_CLASS),
);

/** A literal receiver node names its core class outright. */
export const literalCoreClass = (n: Node): string | null =>
  LITERAL_CLASS[n.type] ?? null;

// `Klass.new` / `Klass::Nested.new` -> the constant path, else null.
const newTargetPath = (rhs: Node): string | null => {
  if (rhs.type !== "call") return null;
  if (rhs.childForFieldName("method")?.text !== "new") return null;
  const recv = rhs.childForFieldName("receiver");
  return recv?.type === "constant" || recv?.type === "scope_resolution"
    ? recv.text
    : null;
};

const enclosingMethod = (node: Node): Node | null => {
  for (let p = node.parent; p; p = p.parent) {
    if (p.type === "method" || p.type === "singleton_method") return p;
  }
  return null;
};

// A dangling completion dot (`h.` before `end`) makes tree-sitter eat the
// following keyword as the method name and collapse the enclosing def into an
// ERROR node, so `enclosingMethod` finds nothing. The assignment still parses
// as a sibling statement, so fall back to the nearest statement container.
const STATEMENT_SCOPES = new Set([
  "method",
  "singleton_method",
  "do_block",
  "block",
  "body_statement",
  "then",
  "else",
  "ensure",
  "begin",
  "program",
]);
const enclosingStatementScope = (node: Node): Node | null => {
  for (let p = node.parent; p; p = p.parent) {
    if (STATEMENT_SCOPES.has(p.type)) return p;
  }
  return null;
};

/** Symbol keys of a hash literal (`{ f: 1, :g => 2 }` -> ["f", "g"]). String
 * keys aren't dot-accessible in DragonRuby, so they're skipped. */
export const hashLiteralKeys = (hash: Node): string[] => {
  const keys: string[] = [];
  for (let i = 0; i < hash.namedChildCount; i++) {
    const pair = hash.namedChild(i)!;
    if (pair.type !== "pair") continue;
    const key = pair.childForFieldName("key") ?? pair.namedChild(0);
    if (key?.type === "hash_key_symbol") keys.push(key.text);
    else if (key?.type === "simple_symbol") {
      keys.push(key.text.replace(/^:/, ""));
    }
  }
  return keys;
};

const enclosingClass = (node: Node): Node | null => {
  for (let p = node.parent; p; p = p.parent) {
    if (p.type === "class" || p.type === "module") return p;
  }
  return null;
};

export class Resolver implements ConstResolver {
  #ws: Workspace;
  #nsIndex = new Map<string, Def>();
  #nsGeneration = -1;
  #methodsByContainer = new Map<string, Def[]>();
  #methodsGeneration = -1;

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

  /** Parameter, block-parameter, and local-variable names of the method
   * enclosing `pos` — the locals a bare identifier there could refer to. */
  localsInScope(uri: string, pos: Pos): string[] {
    const tree = this.#ws.fileTree(uri);
    if (!tree) return [];
    const node = tree.rootNode.descendantForPosition({
      row: pos.line,
      column: pos.character,
    });
    const scope = node &&
      (enclosingMethod(node) ?? enclosingStatementScope(node));
    if (!scope) return [];

    const names = new Set<string>();
    const nameOf = (child: Node): string | undefined =>
      child.type === "identifier" ? child.text : child.childForFieldName("name")
        ?.text;

    const params = scope.childForFieldName("parameters");
    for (let i = 0; i < (params?.namedChildCount ?? 0); i++) {
      const n = nameOf(params!.namedChild(i)!);
      if (n) names.add(n);
    }
    const scan = (n: Node) => {
      if (n.type === "block_parameters") {
        for (let i = 0; i < n.namedChildCount; i++) {
          const name = nameOf(n.namedChild(i)!);
          if (name) names.add(name);
        }
      }
      if (n.type === "assignment") {
        const left = n.childForFieldName("left");
        if (left?.type === "identifier") names.add(left.text);
      }
      for (let i = 0; i < n.namedChildCount; i++) scan(n.namedChild(i)!);
    };
    scan(scope);
    return [...names];
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
      ns = this.#superclassOf(ns);
    }

    const inFile = found.filter((f) => f.uri === uri);
    return inFile.length > 0 ? inFile : null;
  }

  /** Instance (default) or singleton method Defs of `qualifiedClass` and every
   * class up its superclass chain, nearest class first. The chain walk is class
   * hierarchy, not an inference hop, so it's always permitted. Cached against
   * `ws.generation`; cycle-guarded via `classChain`. */
  methodsOf(qualifiedClass: string, opts: { singleton?: boolean } = {}): Def[] {
    this.#ensureMethodIndex();
    const wantSingleton = opts.singleton === true;
    const out: Def[] = [];
    for (const ns of this.#classChain(qualifiedClass)) {
      for (const m of this.#methodsByContainer.get(ns) ?? []) {
        if (!!m.singleton === wantSingleton) out.push(m);
      }
    }
    return out;
  }

  /** One explicit hop of receiver typing (§3.2). Returns a core class or a
   * workspace-qualified class plus the rule that fired, or null when nothing is
   * certain. The `return`-dispatch rule may type the immediately-prior receiver,
   * but that result is never re-fed to type a further one — the chain stops. */
  receiverType(uri: string, receiver: Node): TypeGuess | null {
    return this.#receiverType(uri, receiver, true);
  }

  /** The single literal RHS a local was assigned in `method`, if assigned
   * exactly once, never reassigned, and never mutated in place — element
   * assignment (`p[:y] = 0`) or a bang/`store` call changes the shape at
   * runtime, so the type is no longer certain and this returns null (the
   * diagnostics shape-check must never fire on an uncertain type — principle 2).
   */
  sameMethodLiteral(method: Node, name: string): Node | null {
    const assignments: Node[] = [];
    let mutated = false;

    const scan = (n: Node) => {
      if (n.type === "assignment") {
        const left = n.childForFieldName("left");
        if (left?.type === "identifier" && left.text === name) {
          assignments.push(n);
        } else if (left?.type === "element_reference") {
          const obj = left.childForFieldName("object") ?? left.namedChild(0);
          if (obj?.type === "identifier" && obj.text === name) mutated = true;
        }
      }
      if (n.type === "call") {
        const recv = n.childForFieldName("receiver");
        const m = n.childForFieldName("method")?.text ?? "";
        if (
          recv?.type === "identifier" && recv.text === name &&
          (m.endsWith("!") || m === "store")
        ) {
          mutated = true;
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) scan(n.namedChild(i)!);
    };
    scan(method);

    if (assignments.length !== 1 || mutated) return null;
    const rhs = assignments[0].childForFieldName("right");
    return rhs && rhs.type in LITERAL_CLASS ? rhs : null;
  }

  #receiverType(
    uri: string,
    receiver: Node,
    allowReturn: boolean,
  ): TypeGuess | null {
    if (receiver.type === "identifier") {
      return this.#typeLocal(uri, receiver);
    }
    if (receiver.type === "instance_variable") {
      return this.#typeIvar(receiver);
    }
    if (receiver.type === "call" && allowReturn) {
      return this.#typeReturn(uri, receiver);
    }
    return null;
  }

  // Rule 1 (literal) + rule 2 (`Klass.new`): the nearest preceding same-method
  // assignment of this local.
  #typeLocal(uri: string, receiver: Node): TypeGuess | null {
    const scope = enclosingMethod(receiver) ??
      enclosingStatementScope(receiver);
    if (!scope) return null;
    const name = receiver.text;

    let best: Node | null = null;
    const scan = (n: Node) => {
      if (n.type === "assignment") {
        const left = n.childForFieldName("left");
        if (
          left?.type === "identifier" && left.text === name &&
          n.startIndex < receiver.startIndex &&
          (!best || n.startIndex > best.startIndex)
        ) {
          best = n;
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) scan(n.namedChild(i)!);
    };
    scan(scope);
    const rhs = (best as Node | null)?.childForFieldName("right");
    if (!rhs) return null;

    const core = LITERAL_CLASS[rhs.type];
    if (core) {
      const keys = rhs.type === "hash" ? hashLiteralKeys(rhs) : undefined;
      return {
        class: core,
        source: "literal",
        ...(keys?.length ? { keys } : {}),
      };
    }

    const path = newTargetPath(rhs);
    if (path) {
      const cls = this.resolveConstName(
        path,
        this.enclosingNamespace(receiver),
      );
      if (cls) return { class: cls, source: "new" };
    }
    return null;
  }

  // Rule 3: every `@ivar = …` in the enclosing class body must agree on one
  // literal/`new` type; any untypeable or conflicting assignment -> null.
  // A dangling completion dot collapses the enclosing class into an ERROR node
  // (the def survives but its `class` parent doesn't), so fall back to the
  // nearest statement scope where the assignment still parses.
  #typeIvar(receiver: Node): TypeGuess | null {
    const scope = enclosingClass(receiver) ??
      enclosingStatementScope(receiver);
    if (!scope) return null;
    const name = receiver.text;

    const types: (string | null)[] = [];
    const rhsNodes: Node[] = [];
    const scan = (n: Node) => {
      if (n.type === "assignment") {
        const left = n.childForFieldName("left");
        if (left?.type === "instance_variable" && left.text === name) {
          const rhs = n.childForFieldName("right");
          types.push(rhs ? this.#assignedClass(rhs, left) : null);
          if (rhs) rhsNodes.push(rhs);
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) scan(n.namedChild(i)!);
    };
    scan(scope);

    if (types.length === 0 || types.some((t) => t === null)) return null;
    const uniq = new Set(types);
    if (uniq.size !== 1) return null;
    // A single hash-literal assignment exposes its keys; multiple assignments
    // (even all hashes) don't share a known key set.
    const keys = rhsNodes.length === 1 && rhsNodes[0].type === "hash"
      ? hashLiteralKeys(rhsNodes[0])
      : undefined;
    return {
      class: [...uniq][0]!,
      source: "ivar",
      ...(keys?.length ? { keys } : {}),
    };
  }

  #assignedClass(rhs: Node, site: Node): string | null {
    const core = LITERAL_CLASS[rhs.type];
    if (core) return core;
    const path = newTargetPath(rhs);
    return path
      ? this.resolveConstName(path, this.enclosingNamespace(site))
      : null;
  }

  // Rule 4: the receiver is a call `recv.meth`; type it by `meth`'s @return when
  // `meth` resolves to exactly one workspace method (globally unique by name, or
  // unique within `recv`'s own type — one nested, return-free hop).
  #typeReturn(uri: string, receiver: Node): TypeGuess | null {
    const nameNode = receiver.childForFieldName("method");
    if (!nameNode) return null;
    const candidates = (this.#ws.defs.get(nameNode.text) ?? []).filter((d) =>
      d.kind === "method"
    );
    if (candidates.length === 0) return null;

    let target: Def | null = null;
    if (new Set(candidates.map((c) => c.container ?? "")).size === 1) {
      target = candidates[0];
    } else {
      const recv = receiver.childForFieldName("receiver");
      const recvType = recv ? this.#receiverType(uri, recv, false) : null;
      if (recvType) {
        const chain = new Set(this.#classChain(recvType.class));
        const inChain = candidates.filter((c) => chain.has(c.container ?? ""));
        if (new Set(inChain.map((c) => c.container ?? "")).size === 1) {
          target = inChain[0];
        }
      }
    }
    if (!target) return null;

    const t = target.doc?.match(/@return\s+\[([^\]]+)\]/)?.[1]
      .match(/[A-Z][\w:]*/)?.[0];
    if (!t) return null;
    const cls = this.resolveConstName(t, target.container ?? "");
    return cls ? { class: cls, source: "return" } : null;
  }

  #classChain(qualified: string): string[] {
    const chain: string[] = [];
    const seen = new Set<string>();
    let ns = qualified;
    while (ns && !seen.has(ns)) {
      seen.add(ns);
      chain.push(ns);
      ns = this.#superclassOf(ns);
    }
    return chain;
  }

  /** The qualified name of `ns`'s direct superclass, resolved from `ns`'s own
   * enclosing namespace, or "" when it has none / can't be resolved. */
  #superclassOf(ns: string): string {
    const cls = this.namespaceIndex().get(ns);
    if (!cls?.superclass) return "";
    return this.resolveConstName(
      cls.superclass,
      ns.split("::").slice(0, -1).join("::"),
    ) ?? "";
  }

  #ensureMethodIndex(): void {
    if (this.#methodsGeneration === this.#ws.generation) return;
    this.#methodsByContainer = new Map();
    for (const locs of this.#ws.defs.values()) {
      for (const loc of locs) {
        if (loc.kind !== "method" || !loc.container) continue;
        const list = this.#methodsByContainer.get(loc.container) ?? [];
        list.push(loc);
        this.#methodsByContainer.set(loc.container, list);
      }
    }
    this.#methodsGeneration = this.#ws.generation;
  }
}
