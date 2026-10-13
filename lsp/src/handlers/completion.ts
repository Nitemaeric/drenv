import {
  CORE_CLASSES,
  hashLiteralKeys,
  literalCoreClass,
  selfIsSingleton,
} from "../resolve.ts";
import type { Node } from "../ruby.ts";
import type { Def, Pos } from "../types.ts";
import type { Ctx } from "./ctx.ts";

export const completion = (ctx: Ctx, uri: string, pos: Pos): unknown[] => {
  const { ws, resolver, yard, engine } = ctx;
  const line = (ws.fileText(uri) ?? "").split("\n")[pos.line] ?? "";
  const prefix = line.slice(0, pos.character);

  const completeCore = (cls: string): unknown[] => {
    const docs = engine.methodDocs(cls);
    const labels = new Set(engine.coreMethods(cls) ?? []);
    for (const name of docs?.keys() ?? []) labels.add(name);
    return [...labels].map((label) => ({
      label,
      kind: 2, // Method
      documentation: {
        kind: "markdown",
        value: docs?.get(label) ?? `mruby \`${cls}#${label}\``,
      },
    }));
  };

  // `@`/`@@` sigil: instance or class variables of the enclosing class chain.
  // The edit range spans the sigil so clients whose word pattern stops at `@`
  // still filter and replace the whole name.
  const sigil = prefix.match(/(?<![\w@])(@@?)\w*$/);
  if (sigil) {
    const start = pos.character - sigil[0].length;
    const kind = sigil[1] === "@@" ? "class_variable" : "instance_variable";
    return resolver.variablesInScope(uri, pos, kind).map((name) => ({
      label: name,
      kind: 6, // Variable
      filterText: name,
      textEdit: {
        range: { start: { line: pos.line, character: start }, end: pos },
        newText: name,
      },
    }));
  }

  // `Camera::` / `Game::Ui::`: what that namespace defines — nested classes,
  // modules and constants.
  const scoped = prefix.match(
    /(?<![\w:])((?:::)?[A-Z]\w*(?:::[A-Z]\w*)*)::\w*$/,
  );
  if (scoped) {
    const here = ws.fileTree(uri)?.rootNode.descendantForPosition({
      row: pos.line,
      column: pos.character,
    });
    const ns = resolver.resolveConstName(
      scoped[1].replace(/^::/, ""),
      here ? resolver.enclosingNamespace(here) : "",
    );
    if (!ns) return [];
    const items: unknown[] = [];
    for (const [name, locs] of ws.defs) {
      const def = locs.find((l) =>
        l.container === ns && l.kind && l.kind !== "method"
      );
      if (def) items.push(constantItem(name, def));
    }
    return items;
  }

  const chain = prefix.match(/([A-Za-z_][\w.]*)\.\s*[\w]*$/)?.[1];
  if (chain) {
    const entries = engine.api.get(chain);
    if (entries) {
      return entries.map((e) => ({
        label: e.label,
        kind: 2, // Method
        detail: e.signature,
        documentation: { kind: "markdown", value: e.doc },
      }));
    }
  }

  const cls = engine.literalClass(prefix);
  if (cls) return completeCore(cls);

  // One-hop typed receiver: `enemies = []` → `enemies.` completes Array;
  // `@anim = Klass.new` → `@anim.` completes the class's methods (inherited too);
  // `h = { f: 1 }` → `h.` completes the hash's keys (DragonRuby dot-access) too.
  const recv = receiverNode(ctx, uri, pos, prefix);
  if (recv) {
    const lit = literalCoreClass(recv);
    const guess = lit
      ? { class: lit, keys: recv.type === "hash" ? hashLiteralKeys(recv) : [] }
      : resolver.receiverType(uri, recv);
    if (guess?.class) {
      const keyItems = (guess.keys ?? []).map((key) => ({
        label: key,
        kind: 5, // Field
        detail: "hash key",
      }));
      if (CORE_CLASSES.has(guess.class)) {
        return [...keyItems, ...completeCore(guess.class)];
      }
      // `Camera.` / `self.` in a class method: class-level methods (`def
      // self.x`, `class << self`, `extend`ed modules) up the superclass chain,
      // plus `new` on a class. Otherwise the instance methods.
      const singleton = "singleton" in guess && guess.singleton;
      const typed = defCompletions(
        ctx,
        resolver.methodsOf(guess.class, { singleton }),
      );
      if (
        singleton &&
        resolver.namespaceIndex().get(guess.class)?.kind === "class"
      ) {
        typed.push({ label: "new", kind: 2, detail: `${guess.class}.new` });
      }
      if (keyItems.length > 0 || typed.length > 0) {
        return [...keyItems, ...typed];
      }
    }
    // A member access on a receiver we can't type gets no completions — never
    // the bare-identifier list below (every class/method name), which is
    // meaningless after a dot.
    return [];
  }

  // Bare identifier (no receiver): only what Ruby could actually reach here —
  // locals in scope, methods on `self` (the enclosing class chain) or defined
  // at top level, and constants. NOT every method name in the workspace: a
  // bare call can't reach an unrelated class's method.
  const node = ws.fileTree(uri)?.rootNode.descendantForPosition({
    row: pos.line,
    column: pos.character,
  });
  // Methods callable on self here: instance methods inside `def x`, class
  // methods inside `def self.x` / `class << self`.
  const ns = node ? resolver.enclosingNamespace(node) : "";
  const onSelf = new Set(
    ns && node
      ? resolver.methodsOf(ns, { singleton: selfIsSingleton(node) })
      : [],
  );

  const items: unknown[] = resolver.localsInScope(uri, pos).map((name) => ({
    label: name,
    kind: 6, // Variable
  }));

  for (const [name, locs] of ws.defs) {
    // Classes/modules are referenceable by name; methods only when reachable
    // on self or defined at the top level (container-less).
    const isConst = locs.some((l) => l.kind === "class" || l.kind === "module");
    const reachableMethod = locs.some((l) =>
      onSelf.has(l) || (l.kind === "method" && !l.container && !l.singleton)
    );
    if (!isConst && !reachableMethod) continue;

    const docs = [...new Set(locs.map((l) => l.doc).filter(Boolean))];
    const documented = locs.find((l) => l.doc);
    items.push({
      label: name,
      kind: isConst ? 7 : 3, // Class : Function
      ...(docs.length === 1
        ? {
          documentation: {
            kind: "markdown",
            value: yard.render(docs[0]!, documented?.container ?? ""),
          },
        }
        : {}),
    });
  }
  for (const [name, def] of resolver.constantsInScope(ns)) {
    items.push(constantItem(name, def));
  }
  for (const mod of ["Geometry", "Easing"]) {
    if (engine.api.has(mod)) items.push({ label: mod, kind: 9 }); // Module
  }
  return items;
};

const constantItem = (name: string, def: Def) => ({
  label: name,
  kind: def.kind === "constant" ? 21 : def.kind === "module" ? 9 : 7,
  ...(def.value ? { detail: `= ${def.value}` } : {}),
});

// Node types a receiver can be built from when climbing out of its last token;
// statement containers (`block_body`, `body_statement`) end at the same column
// but aren't the receiver.
const RECEIVER_EXPRESSIONS = new Set([
  "call",
  "element_reference",
  "argument_list",
  "array",
  "hash",
  "string",
  "parenthesized_statements",
  "scope_resolution",
]);

// The receiver expression immediately before the completion dot. Returns the
// full call node for a chained receiver (`camera.ui`), else the identifier/ivar.
const receiverNode = (
  ctx: Ctx,
  uri: string,
  pos: Pos,
  prefix: string,
): Node | null => {
  const tree = ctx.ws.fileTree(uri);
  if (!tree) return null;
  const dot = prefix.match(/\.\s*\w*$/);
  if (!dot) return null;
  const dotCol = pos.character - dot[0].length;
  if (dotCol <= 0) return null;

  let node: Node | null = tree.rootNode.descendantForPosition({
    row: pos.line,
    column: dotCol - 1,
  });
  // Climb to the whole receiver expression when it ends exactly at the dot
  // (`camera.ui.` → the `camera.ui` call, not its `ui` method name;
  // `list.first(2).` / `list[0].` → the call / element reference, not the
  // closing bracket).
  while (
    node?.parent &&
    node.parent.endPosition.row === pos.line &&
    node.parent.endPosition.column === dotCol &&
    RECEIVER_EXPRESSIONS.has(node.parent.type)
  ) {
    node = node.parent;
  }
  return node;
};

// Method Defs (from `methodsOf`) as completion items. Names come from the def
// index, since a Def doesn't carry its own name key.
const defCompletions = (ctx: Ctx, defs: Def[]): unknown[] => {
  const { ws, yard } = ctx;
  const wanted = new Set(defs);
  const items: unknown[] = [];
  for (const [name, locs] of ws.defs) {
    const methods = locs.filter((l) => wanted.has(l));
    if (methods.length === 0) continue;
    const docs = [...new Set(methods.map((l) => l.doc).filter(Boolean))];
    const documented = methods.find((l) => l.doc);
    items.push({
      label: name,
      kind: 2, // Method
      ...(docs.length === 1
        ? {
          documentation: {
            kind: "markdown",
            value: yard.render(docs[0]!, documented?.container ?? ""),
          },
        }
        : {}),
    });
  }
  return items;
};
