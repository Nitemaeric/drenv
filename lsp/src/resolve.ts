import type { Node } from "./ruby.ts";
import type { ConstResolver, Def, Loc, Pos } from "./types.ts";
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
  source:
    | "literal"
    | "new"
    | "ivar"
    | "return"
    | "self"
    | "const"
    | "element";
  keys?: string[];
  /** For an Array: the one class every known element has (`[Foo.new]`,
   * `list << Foo.new`), so block parameters and `list.first` can type. */
  element?: string;
  /** The receiver is the class object itself (`Camera`, `self` in a
   * `def self.x`), so its class-level methods apply, not instance methods. */
  singleton?: boolean;
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

// The outermost ERROR ancestor: what's left of a class body a dangling dot
// collapsed, which still holds its sibling methods' assignments.
const outermostError = (node: Node): Node | null => {
  let out: Node | null = null;
  for (let p = node.parent; p; p = p.parent) {
    if (p.type === "ERROR") out = p;
  }
  return out;
};

const enclosingClass = (node: Node): Node | null => {
  for (let p = node.parent; p; p = p.parent) {
    if (p.type === "class" || p.type === "module") return p;
  }
  return null;
};

/** The constant path a `constant` node names: the whole `A::B` when it's the
 * right-hand name of a scope resolution, else just its own text. A leading
 * `::` (top-level) is dropped. */
export const constPathAt = (node: Node): string => {
  const parent = node.parent;
  const path = parent?.type === "scope_resolution" &&
      parent.childForFieldName("name")?.id === node.id
    ? parent.text
    : node.text;
  return path.replace(/^::/, "");
};

/** Whether `self` at `node` is the class object rather than an instance: inside
 * `def self.x`, a `class << self` body, or a class body outside any method. */
export const selfIsSingleton = (node: Node): boolean => {
  for (let p: Node | null = node; p; p = p.parent) {
    if (p.type === "method") return false;
    if (
      p.type === "singleton_method" || p.type === "singleton_class" ||
      p.type === "class" || p.type === "module"
    ) {
      return true;
    }
  }
  return false;
};

// Array methods whose block's first parameter is an element.
const YIELDS_ELEMENT = new Set([
  "each",
  "each_with_index",
  "each_with_object",
  "reverse_each",
  "map",
  "map!",
  "collect",
  "flat_map",
  "filter_map",
  "select",
  "select!",
  "filter",
  "filter!",
  "reject",
  "reject!",
  "delete_if",
  "keep_if",
  "find",
  "detect",
  "find_all",
  "find_index",
  "index",
  "count",
  "sum",
  "any?",
  "all?",
  "none?",
  "one?",
  "partition",
  "group_by",
  "sort_by",
  "sort_by!",
  "min_by",
  "max_by",
  "take_while",
  "drop_while",
  "uniq",
]);
// Array methods returning an Array of the receiver's elements.
const KEEPS_ELEMENTS = new Set([
  "select",
  "select!",
  "filter",
  "filter!",
  "reject",
  "reject!",
  "find_all",
  "delete_if",
  "keep_if",
  "sort",
  "sort!",
  "sort_by",
  "sort_by!",
  "reverse",
  "reverse!",
  "uniq",
  "uniq!",
  "compact",
  "compact!",
  "shuffle",
  "shuffle!",
  "rotate",
  "take",
  "drop",
  "take_while",
  "drop_while",
  "dup",
  "clone",
  "freeze",
  "each",
  "each_with_index",
  "reverse_each",
]);
// Array methods returning one of the receiver's elements (`first(2)` and
// `last(2)` return an Array instead).
const RETURNS_ELEMENT = new Set([
  "first",
  "last",
  "sample",
  "find",
  "detect",
  "min",
  "max",
  "min_by",
  "max_by",
  "pop",
  "shift",
  "delete_at",
  "fetch",
  "at",
]);
// Integer methods yielding integers to their block.
const YIELDS_INTEGER = new Set(["times", "upto", "downto"]);

// `x = …` and `x ||= …` both bind `x` for typing purposes.
const bindingLeft = (n: Node): Node | null => {
  if (n.type === "assignment") return n.childForFieldName("left");
  if (n.type === "operator_assignment" && n.child(1)?.type === "||=") {
    return n.childForFieldName("left");
  }
  return null;
};

export class Resolver implements ConstResolver {
  #ws: Workspace;
  #nsIndex = new Map<string, Def>();
  #nsGeneration = -1;
  #methodsByContainer = new Map<string, Def[]>();
  #methodsGeneration = -1;
  #mixinIndex = new Map<string, { includes: string[]; extends: string[] }>();
  #mixinGeneration = -1;

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

  /** Instance (`@x`) or class (`@@x`) variable names reachable at `pos`: every
   * one written or read in a body of the enclosing class/module or its
   * ancestors, across all workspace files (classes reopen). Top-level code
   * shares the `main` object, so it sees every top-level variable. The node
   * under the cursor (the partially typed name) is skipped. */
  variablesInScope(
    uri: string,
    pos: Pos,
    kind: "instance_variable" | "class_variable",
  ): string[] {
    const tree = this.#ws.fileTree(uri);
    if (!tree) return [];
    const here = tree.rootNode.descendantForPosition({
      row: pos.line,
      column: pos.character,
    });
    const ns = here ? this.enclosingNamespace(here) : "";
    const visible = new Set(ns ? this.ancestors(ns) : [""]);

    const names = new Set<string>();
    for (const fileUri of this.#ws.fileUris()) {
      const root = this.#ws.fileTree(fileUri)?.rootNode;
      if (!root) continue;
      for (const n of root.descendantsOfType(kind)) {
        if (!n) continue;
        const typing = fileUri === uri &&
          n.startPosition.row === pos.line &&
          n.startPosition.column <= pos.character &&
          n.endPosition.column >= pos.character;
        if (typing) continue;
        if (visible.has(this.enclosingNamespace(n))) names.add(n.text);
      }
    }
    return [...names];
  }

  /** Every `$global` named in the workspace, except the one being typed at
   * `pos`. */
  globalNames(uri: string, pos: Pos): string[] {
    const names = new Set<string>();
    for (const n of this.#nodesOf("global_variable")) {
      if (
        n.uri === uri && n.range.start.line === pos.line &&
        n.range.start.character <= pos.character &&
        n.range.end.character >= pos.character
      ) continue;
      names.add(n.text);
    }
    return [...names];
  }

  /** Occurrences of the instance, class or global variable `node` names:
   * globals anywhere; `@x`/`@@x` in the same class or its ancestors. */
  variableRefs(uri: string, node: Node): Loc[] {
    const visible = node.type === "global_variable"
      ? null
      : new Set(this.ancestors(this.enclosingNamespace(node)));
    if (visible && visible.size === 0) visible.add("");
    return this.#nodesOf(node.type)
      .filter((n) => n.text === node.text && (!visible || visible.has(n.ns)))
      .map(({ uri, range }) => ({ uri, range }));
  }

  /** Where `$name` is assigned (`=` or `||=`), across the workspace. */
  globalAssignments(name: string): Loc[] {
    return this.#nodesOf("global_variable")
      .filter((n) => n.text === name && n.assigned)
      .map(({ uri, range }) => ({ uri, range }));
  }

  #nodesOf(type: string): {
    uri: string;
    range: Loc["range"];
    text: string;
    ns: string;
    assigned: boolean;
  }[] {
    const out = [];
    for (const uri of this.#ws.fileUris()) {
      const root = this.#ws.fileTree(uri)?.rootNode;
      if (!root) continue;
      for (const n of root.descendantsOfType(type)) {
        if (!n) continue;
        out.push({
          uri,
          range: {
            start: {
              line: n.startPosition.row,
              character: n.startPosition.column,
            },
            end: { line: n.endPosition.row, character: n.endPosition.column },
          },
          text: n.text,
          ns: this.enclosingNamespace(n),
          assigned: !!n.parent && bindingLeft(n.parent)?.id === n.id,
        });
      }
    }
    return out;
  }

  /** Qualified class/module name -> Def, rebuilt when the def index moves. */
  namespaceIndex(): Map<string, Def> {
    if (this.#nsGeneration === this.#ws.generation) return this.#nsIndex;
    this.#nsIndex = new Map();
    for (const [name, locs] of this.#ws.defs) {
      for (const loc of locs) {
        if (loc.kind !== "class" && loc.kind !== "module") continue;
        const qualified = loc.container ? `${loc.container}::${name}` : name;
        // First body wins, except that a reopening without `< Base` must not
        // hide the declaration that names the superclass.
        const seen = this.#nsIndex.get(qualified);
        if (!seen || (!seen.superclass && loc.superclass)) {
          this.#nsIndex.set(qualified, loc);
        }
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

  /** A class, module or value constant (`SCREEN_W = 1280`) by Ruby's lookup:
   * lexical scopes outward, then the enclosing class's ancestors. */
  resolveConst(path: string, container: string): Def | null {
    const index = this.#constantIndex();
    const parts = container ? container.split("::") : [];
    for (let i = parts.length; i >= 0; i--) {
      const prefix = parts.slice(0, i).join("::");
      const def = index.get(prefix ? `${prefix}::${path}` : path);
      if (def) return def;
    }
    for (const ns of this.ancestors(container).slice(1)) {
      const def = index.get(`${ns}::${path}`);
      if (def) return def;
    }
    return null;
  }

  /** Value constants and namespaces visible from `container` without a
   * prefix: those of each lexical scope, the ancestors, and the top level. */
  constantsInScope(container: string): Map<string, Def> {
    const scopes = new Set<string>([""]);
    const parts = container ? container.split("::") : [];
    for (let i = 1; i <= parts.length; i++) {
      scopes.add(parts.slice(0, i).join("::"));
    }
    for (const ns of this.ancestors(container)) scopes.add(ns);
    const out = new Map<string, Def>();
    for (const [name, locs] of this.#ws.defs) {
      const hit = locs.find((l) =>
        l.kind === "constant" && scopes.has(l.container ?? "")
      );
      if (hit) out.set(name, hit);
    }
    return out;
  }

  // Qualified name -> class/module/constant Def; namespaces win a tie.
  #constIndexCache = new Map<string, Def>();
  #constIndexGeneration = -1;
  #constantIndex(): Map<string, Def> {
    if (this.#constIndexGeneration === this.#ws.generation) {
      return this.#constIndexCache;
    }
    const index = new Map(this.namespaceIndex());
    for (const [name, locs] of this.#ws.defs) {
      for (const loc of locs) {
        if (loc.kind !== "constant") continue;
        const q = loc.container ? `${loc.container}::${name}` : name;
        if (!index.has(q)) index.set(q, loc);
      }
    }
    this.#constIndexCache = index;
    this.#constIndexGeneration = this.#ws.generation;
    return index;
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

    for (const ns of this.ancestors(this.enclosingNamespace(node))) {
      const hits = found.filter((f) => f.container === ns);
      if (hits.length > 0) return hits;
    }

    const inFile = found.filter((f) => f.uri === uri);
    return inFile.length > 0 ? inFile : null;
  }

  /** Instance (default) or singleton method Defs reachable on `qualifiedClass`,
   * nearest first. The walk is class hierarchy (superclass chain + `include`d /
   * `extend`ed modules), not an inference hop, so it's always permitted. Cached
   * against `ws.generation`; cycle-guarded. */
  methodsOf(qualifiedClass: string, opts: { singleton?: boolean } = {}): Def[] {
    this.#ensureMethodIndex();
    const out: Def[] = [];
    if (opts.singleton === true) {
      // `Class.x`: each class in the superclass chain contributes its own
      // singleton methods plus the *instance* methods of the modules it
      // `extend`s (extend adds a module's instance methods as class methods).
      for (const ns of this.#classChain(qualifiedClass)) {
        for (const m of this.#methodsByContainer.get(ns) ?? []) {
          if (m.singleton || m.moduleFunction) out.push(m);
        }
        for (const mod of this.#mixins(ns).extends) {
          const q = this.resolveConstName(mod, ns);
          for (const m of this.#methodsByContainer.get(q ?? "") ?? []) {
            if (!m.singleton) out.push(m);
          }
        }
      }
    } else {
      for (const ns of this.ancestors(qualifiedClass)) {
        for (const m of this.#methodsByContainer.get(ns) ?? []) {
          if (!m.singleton) out.push(m);
        }
      }
    }
    return out;
  }

  /** Qualified names whose instance methods are reachable on an instance of
   * `qualified`: itself, the modules it `include`s (recursively), and its
   * superclass chain (each expanded likewise), nearest first. `extend` mixes in
   * singleton methods, not instance methods, so it's excluded here. Cycle-
   * guarded — reopened classes and mutual includes both terminate. */
  ancestors(qualified: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const visit = (ns: string) => {
      if (!ns || seen.has(ns)) return;
      seen.add(ns);
      out.push(ns);
      for (const mod of this.#mixins(ns).includes) {
        const q = this.resolveConstName(mod, ns);
        if (q) visit(q);
      }
      visit(this.#superclassOf(ns));
    };
    visit(qualified);
    return out;
  }

  /** `include` / `extend` module names declared on a namespace, unioned across
   * every file that reopens it. Cached against `ws.generation`. */
  #mixins(qualified: string): { includes: string[]; extends: string[] } {
    if (this.#mixinGeneration !== this.#ws.generation) {
      this.#mixinIndex = new Map();
      for (const [name, locs] of this.#ws.defs) {
        for (const loc of locs) {
          if (loc.kind !== "class" && loc.kind !== "module") continue;
          if (!loc.includes && !loc.extends) continue;
          const q = loc.container ? `${loc.container}::${name}` : name;
          const bag = this.#mixinIndex.get(q) ??
            { includes: [], extends: [] };
          if (loc.includes) bag.includes.push(...loc.includes);
          if (loc.extends) bag.extends.push(...loc.extends);
          this.#mixinIndex.set(q, bag);
        }
      }
      this.#mixinGeneration = this.#ws.generation;
    }
    return this.#mixinIndex.get(qualified) ?? { includes: [], extends: [] };
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
    if (
      receiver.type === "instance_variable" ||
      receiver.type === "class_variable"
    ) {
      return this.#typeIvar(receiver);
    }
    if (receiver.type === "global_variable") {
      return this.#typeGlobal(receiver);
    }
    if (receiver.type === "self") {
      const ns = this.enclosingNamespace(receiver);
      return ns
        ? { class: ns, source: "self", singleton: selfIsSingleton(receiver) }
        : null;
    }
    if (receiver.type === "constant" || receiver.type === "scope_resolution") {
      const ns = this.resolveConstName(
        receiver.text,
        this.enclosingNamespace(receiver),
      );
      return ns ? { class: ns, source: "const", singleton: true } : null;
    }
    if (receiver.type === "element_reference") {
      // `list[0]` on an Array of known elements.
      const obj = receiver.childForFieldName("object");
      const t = obj ? this.#receiverType(uri, obj, allowReturn) : null;
      return t?.class === "Array" && t.element
        ? { class: t.element, source: "element" }
        : null;
    }
    if (receiver.type === "call") {
      const inner = receiver.childForFieldName("receiver");
      const m = receiver.childForFieldName("method")?.text ?? "";
      if (inner && (KEEPS_ELEMENTS.has(m) || RETURNS_ELEMENT.has(m))) {
        const t = this.#receiverType(uri, inner, allowReturn);
        if (t?.class === "Array" && t.element) {
          const hasArgs = !!receiver.childForFieldName("arguments");
          const one = RETURNS_ELEMENT.has(m) &&
            !(hasArgs && (m === "first" || m === "last"));
          return one
            ? { class: t.element, source: "element" }
            : { class: "Array", source: t.source, element: t.element };
        }
      }
      // `Klass.new` is a direct instantiation, not an inference hop.
      const path = newTargetPath(receiver);
      if (path) {
        const cls = this.resolveConstName(
          path,
          this.enclosingNamespace(receiver),
        );
        return cls ? { class: cls, source: "new" } : null;
      }
      if (allowReturn) return this.#typeReturn(uri, receiver);
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

    const block = this.#typeBlockParam(uri, receiver);
    if (block !== undefined) return block;

    let best: Node | null = null;
    const scan = (n: Node) => {
      const left = bindingLeft(n);
      if (
        left?.type === "identifier" && left.text === name &&
        n.endIndex <= receiver.startIndex &&
        (!best || n.startIndex > best.startIndex)
      ) {
        best = n;
      }
      for (let i = 0; i < n.namedChildCount; i++) scan(n.namedChild(i)!);
    };
    scan(scope);
    if (!best) {
      // Never assigned here: a parameter (untyped) or a bare call on self.
      const at = {
        line: receiver.startPosition.row,
        character: receiver.startPosition.column,
      };
      return this.localsInScope(uri, at).includes(name)
        ? null
        : this.#typeReturnOf(uri, name, null, receiver);
    }
    const rhs = (best as Node).childForFieldName("right");
    if (!rhs) return null;

    const core = LITERAL_CLASS[rhs.type];
    if (core) {
      const keys = rhs.type === "hash" ? hashLiteralKeys(rhs) : undefined;
      const element = rhs.type === "array"
        ? this.#elementOf(scope, receiver, [rhs])
        : undefined;
      return {
        class: core,
        source: "literal",
        ...(keys?.length ? { keys } : {}),
        ...(element ? { element } : {}),
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
    // `b = boss` / `b = cam.boss` / `b = @anim`: the local takes whatever the
    // right-hand side types to on its own.
    if (
      ["call", "identifier", "instance_variable", "class_variable"].includes(
        rhs.type,
      )
    ) {
      return this.#receiverType(uri, rhs, true);
    }
    return null;
  }

  // Rule 3: every `@ivar = …` (or `@@cvar = …`) in the enclosing class body
  // must agree on one literal/`new` type; any untypeable or conflicting
  // assignment -> null.
  // A dangling completion dot collapses the enclosing class into an ERROR node
  // (the def survives but its `class` parent doesn't), so fall back to the
  // nearest statement scope where the assignment still parses.
  #typeIvar(receiver: Node): TypeGuess | null {
    const scope = enclosingClass(receiver) ?? outermostError(receiver) ??
      enclosingStatementScope(receiver);
    if (!scope) return null;
    const name = receiver.text;

    const types: (string | null)[] = [];
    const rhsNodes: Node[] = [];
    const scan = (n: Node) => {
      const left = bindingLeft(n);
      if (left?.type === receiver.type && left.text === name) {
        const rhs = n.childForFieldName("right");
        types.push(rhs ? this.#assignedClass(rhs, left) : null);
        if (rhs) rhsNodes.push(rhs);
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
    const cls = [...uniq][0]!;
    const element = cls === "Array"
      ? this.#elementOf(scope, receiver, rhsNodes)
      : undefined;
    return {
      class: cls,
      source: "ivar",
      ...(keys?.length ? { keys } : {}),
      ...(element ? { element } : {}),
    };
  }

  // Rule 3 for `$globals`: every assignment across the workspace must agree.
  #typeGlobal(receiver: Node): TypeGuess | null {
    const types: (string | null)[] = [];
    for (const uri of this.#ws.fileUris()) {
      const root = this.#ws.fileTree(uri)?.rootNode;
      for (const n of root?.descendantsOfType("global_variable") ?? []) {
        if (!n || n.text !== receiver.text || !n.parent) continue;
        if (bindingLeft(n.parent)?.id !== n.id) continue;
        const rhs = n.parent.childForFieldName("right");
        types.push(rhs ? this.#assignedClass(rhs, n) : null);
      }
    }
    const uniq = new Set(types);
    if (uniq.size !== 1 || uniq.has(null)) return null;
    return { class: [...uniq][0]!, source: "ivar" };
  }

  // The one class of every element `ref` (a local or ivar) is known to hold in
  // `scope`: the elements of its array-literal assignments plus whatever is
  // pushed onto it (`ref << x`, `ref.push(x)`). Any untypeable or conflicting
  // element -> undefined.
  #elementOf(scope: Node, ref: Node, literals: Node[]): string | undefined {
    const elements: Node[] = [];
    for (const lit of literals) {
      if (lit.type !== "array") return undefined;
      for (let i = 0; i < lit.namedChildCount; i++) {
        elements.push(lit.namedChild(i)!);
      }
    }
    const same = (n: Node | null) =>
      n?.type === ref.type && n.text === ref.text;
    const scan = (n: Node) => {
      if (n.type === "binary" && n.child(1)?.type === "<<") {
        const right = n.childForFieldName("right");
        if (same(n.childForFieldName("left")) && right) elements.push(right);
      } else if (n.type === "call" && same(n.childForFieldName("receiver"))) {
        const m = n.childForFieldName("method")?.text ?? "";
        const args = n.childForFieldName("arguments");
        if (["push", "append", "unshift", "prepend"].includes(m) && args) {
          for (let i = 0; i < args.namedChildCount; i++) {
            elements.push(args.namedChild(i)!);
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) scan(n.namedChild(i)!);
    };
    scan(scope);

    const classes = new Set(elements.map((e) => this.#assignedClass(e, e)));
    if (classes.size !== 1 || classes.has(null)) return undefined;
    return [...classes][0]!;
  }

  // A block parameter (`|e|`) of the nearest block binding `ref`'s name: the
  // element type for an Array iterator's first parameter, Numeric for
  // `n.times { |i| }`. undefined when no block binds the name (it's an
  // ordinary local); null when one does but nothing types it.
  #typeBlockParam(uri: string, ref: Node): TypeGuess | null | undefined {
    for (let p = ref.parent; p; p = p.parent) {
      if (p.type === "method" || p.type === "singleton_method") break;
      if (p.type !== "block" && p.type !== "do_block") continue;
      const params = p.childForFieldName("parameters");
      let index = -1;
      for (let i = 0; i < (params?.namedChildCount ?? 0); i++) {
        const param = params!.namedChild(i)!;
        if (param.type === "identifier" && param.text === ref.text) index = i;
      }
      if (index < 0) continue;

      const call = p.parent?.type === "call" ? p.parent : null;
      const m = call?.childForFieldName("method")?.text ?? "";
      const recv = call?.childForFieldName("receiver");
      if (index !== 0 || !recv) return null;
      if (YIELDS_INTEGER.has(m)) return { class: "Numeric", source: "element" };
      if (!YIELDS_ELEMENT.has(m)) return null;
      const t = this.#receiverType(uri, recv, true);
      return t?.class === "Array" && t.element
        ? { class: t.element, source: "element" }
        : null;
    }
    return undefined;
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
    return this.#typeReturnOf(
      uri,
      nameNode.text,
      receiver.childForFieldName("receiver"),
      receiver,
    );
  }

  // `recv` null is a bare call on self: candidates narrow to the enclosing
  // class chain (or top-level defs) rather than the receiver's type.
  #typeReturnOf(
    uri: string,
    name: string,
    recv: Node | null,
    site: Node,
  ): TypeGuess | null {
    const candidates = (this.#ws.defs.get(name) ?? []).filter((d) =>
      d.kind === "method"
    );
    if (candidates.length === 0) return null;

    let target: Def | null = null;
    if (new Set(candidates.map((c) => c.container ?? "")).size === 1) {
      target = candidates[0];
    } else {
      const recvType = recv
        ? this.#receiverType(uri, recv, false)
        : { class: this.enclosingNamespace(site) };
      if (recvType) {
        const chain = new Set(["", ...this.ancestors(recvType.class)]);
        if (recv) chain.delete("");
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
