import { CORE_CLASSES, hashLiteralKeys, literalCoreClass } from "../resolve.ts";
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
      const typed = classMethodCompletions(ctx, guess.class);
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
  const selfChain = node
    ? classChain(ctx, resolver.enclosingNamespace(node))
    : new Set<string>();

  const items: unknown[] = resolver.localsInScope(uri, pos).map((name) => ({
    label: name,
    kind: 6, // Variable
  }));

  for (const [name, locs] of ws.defs) {
    // Classes/modules are referenceable by name; methods only when reachable
    // on self or from the top level (container-less), and never singletons
    // (those are called as `Class.x`).
    const isConst = locs.some((l) => l.kind === "class" || l.kind === "module");
    const reachableMethod = locs.some((l) =>
      l.kind === "method" && !l.singleton &&
      (!l.container || selfChain.has(l.container))
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
  for (const mod of ["Geometry", "Easing"]) {
    if (engine.api.has(mod)) items.push({ label: mod, kind: 9 }); // Module
  }
  return items;
};

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
  // (`camera.ui.` → the `camera.ui` call, not its `ui` method name).
  while (
    node?.parent?.type === "call" &&
    node.parent.endPosition.row === pos.line &&
    node.parent.endPosition.column === dotCol
  ) {
    node = node.parent;
  }
  return node;
};

// Instance methods of a workspace class and its superclass chain, as completion
// items. Names come from the def index (methodsOf yields Defs without their
// name key); the container set is that same chain.
const classMethodCompletions = (ctx: Ctx, qualified: string): unknown[] => {
  const { ws, yard } = ctx;
  const containers = classChain(ctx, qualified);
  const items: unknown[] = [];
  for (const [name, locs] of ws.defs) {
    const methods = locs.filter((l) =>
      l.kind === "method" && !l.singleton && containers.has(l.container ?? "")
    );
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

const classChain = (ctx: Ctx, qualified: string): Set<string> => {
  const { resolver } = ctx;
  const nsIndex = resolver.namespaceIndex();
  const chain = new Set<string>();
  let ns = qualified;
  while (ns && !chain.has(ns)) {
    chain.add(ns);
    const def: Def | undefined = nsIndex.get(ns);
    ns = def?.superclass
      ? resolver.resolveConstName(
        def.superclass,
        ns.split("::").slice(0, -1).join("::"),
      ) ?? ""
      : "";
  }
  return chain;
};
