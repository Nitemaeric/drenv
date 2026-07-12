import type { Node } from "./ruby.ts";
import { nodeRange } from "./analyze.ts";
import type { Workspace } from "./workspace.ts";

// --- performance hints (from the engine's troubleshoot-performance guide) ---

const GUIDE_BASE =
  "https://docs.dragonruby.org/#/guides/troubleshoot-performance";

export const PERF_GUIDE = `${GUIDE_BASE}?id=array-manipulation`;
const RENDERING_PRIMITIVES = `${GUIDE_BASE}?id=rendering-primitives`;
const RECURSION = `${GUIDE_BASE}?id=recursion`;

/** Base severity for every perf hint (LSP Information); the tick-reachability
 * gate may soften a firing to Hint (4) for methods that are provably invoked
 * but never reached from a `tick`. */
export type Severity = 3 | 4;
/** Resolves the gated severity for a firing anchored at `node`. */
export type SeverityAt = (node: Node) => Severity;

const MUTATORS = new Set([
  "delete",
  "delete_at",
  "delete_if",
  "push",
  "unshift",
  "pop",
  "shift",
  "clear",
  "concat",
  "insert",
  "reject!",
  "select!",
]);

// args.outputs.<layer> append targets. `background_color`/`screenshots` are
// also members of args.outputs but are not append layers — excluded on purpose.
const RENDER_LAYERS = new Set([
  "sprites",
  "solids",
  "labels",
  "lines",
  "borders",
  "primitives",
  "debug",
  "static_sprites",
  "static_solids",
  "static_labels",
  "static_lines",
  "static_borders",
  "static_primitives",
  "static_debug",
]);

const ITERATORS = new Set([
  "each",
  "each_with_index",
  "map",
  "times",
  "upto",
  "downto",
]);

// The map-with-block rule treats a call as a "statement" when it sits directly
// in one of these statement-list parents (tree-sitter Ruby has no
// expression_statement node). Any other parent means the result is consumed.
const STATEMENT_PARENTS = new Set([
  "body_statement",
  "block_body",
  "then",
  "else",
  "ensure",
  "begin",
  "program",
]);

// Flags mutation of a collection inside its own `.each` block — the guide's
// "Array Manipulation" antipattern (collect changes, apply after the loop).
export const mutationDuringIteration = (node: Node, out: unknown[]) => {
  if (node.type !== "call") return;
  if (node.childForFieldName("method")?.text !== "each") return;
  const receiver = node.childForFieldName("receiver")?.text;
  const block = node.childForFieldName("block");
  if (!receiver || !block) return;

  const flag = (target: Node, how: string) =>
    out.push({
      range: nodeRange(target),
      severity: 3, // Information
      source: "drenv",
      code: "array-manipulation",
      codeDescription: { href: PERF_GUIDE },
      message:
        `\`${receiver}\` is ${how} while it's being iterated — collect ` +
        `changes and apply them after the loop (e.g. \`reject!\`). ` +
        `See: Troubleshoot Performance → Array Manipulation.`,
    });

  const scan = (n: Node) => {
    if (n.type === "call") {
      const method = n.childForFieldName("method");
      if (
        method && MUTATORS.has(method.text) &&
        n.childForFieldName("receiver")?.text === receiver
      ) {
        flag(n, `mutated (\`${method.text}\`)`);
      }
    }
    if (n.type === "binary") {
      const operator = n.childForFieldName("operator")?.text;
      if (operator === "<<" && n.childForFieldName("left")?.text === receiver) {
        flag(n, "appended to (`<<`)");
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) scan(n.namedChild(i)!);
  };
  scan(block);
};

// `args.outputs.<layer>` — a `call` whose method is a render layer and whose
// receiver is an `outputs` access. Deliberately literal (`args.outputs.sprites`,
// not an aliased local) so the rule stays certain.
const outputsLayer = (node: Node): string | null => {
  if (node.type !== "call") return null;
  const method = node.childForFieldName("method")?.text;
  if (!method || !RENDER_LAYERS.has(method)) return null;
  const recv = node.childForFieldName("receiver");
  if (recv?.type !== "call") return null;
  return recv.childForFieldName("method")?.text === "outputs" ? method : null;
};

const insideIteration = (node: Node): boolean => {
  for (let p = node.parent; p; p = p.parent) {
    if (p.type !== "block" && p.type !== "do_block") continue;
    const call = p.parent;
    if (
      call?.type === "call" &&
      ITERATORS.has(call.childForFieldName("method")?.text ?? "")
    ) {
      return true;
    }
  }
  return false;
};

/** `args.outputs.<layer> << [ … ]` — an Array primitive pushed to a render
 * layer. Hashes are the fast form. Gate: outputs-layer receiver AND array
 * literal RHS. */
export const arrayPrimitivesRule = (
  node: Node,
  out: unknown[],
  sev: SeverityAt,
) => {
  if (node.type !== "binary") return;
  if (node.childForFieldName("operator")?.text !== "<<") return;
  const left = node.childForFieldName("left");
  const right = node.childForFieldName("right");
  if (!left || right?.type !== "array") return;
  const layer = outputsLayer(left);
  if (!layer) return;
  out.push({
    range: nodeRange(node),
    severity: sev(node),
    source: "drenv",
    code: "array-primitives",
    codeDescription: { href: RENDERING_PRIMITIVES },
    message: `\`outputs.${layer} << [ … ]\` renders an Array primitive — use ` +
      `a Hash (\`<< { x:, y:, w:, h:, path: }\`) instead; Arrays are slower. ` +
      `See: Troubleshoot Performance → Rendering Primitives.`,
  });
};

/** Per-iteration append to a render layer (`outputs.<layer> << x` or
 * `.concat` inside an `each`/`map`/`times`/… block). Building an Array and
 * appending once is cheaper. */
export const bulkConcatRule = (node: Node, out: unknown[], sev: SeverityAt) => {
  let layer: string | null = null;
  if (node.type === "binary") {
    if (node.childForFieldName("operator")?.text !== "<<") return;
    const left = node.childForFieldName("left");
    layer = left ? outputsLayer(left) : null;
  } else if (node.type === "call") {
    if (node.childForFieldName("method")?.text !== "concat") return;
    const recv = node.childForFieldName("receiver");
    layer = recv ? outputsLayer(recv) : null;
  }
  if (!layer || !insideIteration(node)) return;
  out.push({
    range: nodeRange(node),
    severity: sev(node),
    source: "drenv",
    code: "bulk-concatenation",
    codeDescription: { href: RENDERING_PRIMITIVES },
    message:
      `appending to \`outputs.${layer}\` once per iteration — build an ` +
      `Array in the loop and concatenate it to outputs once. ` +
      `See: Troubleshoot Performance → Rendering Primitives.`,
  });
};

// Local names bound in `method` (parameters, block parameters, assignment
// targets) — a bare identifier matching one of these is not a self-call.
const localNamesIn = (method: Node): Set<string> => {
  const locals = new Set<string>();
  const nameOf = (child: Node): string | undefined =>
    child.type === "identifier"
      ? child.text
      : child.childForFieldName("name")?.text;

  const params = method.childForFieldName("parameters");
  if (params) {
    for (let i = 0; i < params.namedChildCount; i++) {
      const n = nameOf(params.namedChild(i)!);
      if (n) locals.add(n);
    }
  }

  const body = method.childForFieldName("body");
  const scan = (n: Node) => {
    if (n.type === "block_parameters") {
      for (let i = 0; i < n.namedChildCount; i++) {
        const name = nameOf(n.namedChild(i)!);
        if (name) locals.add(name);
      }
    }
    if (n.type === "assignment") {
      const left = n.childForFieldName("left");
      if (left?.type === "identifier") locals.add(left.text);
    }
    for (let i = 0; i < n.namedChildCount; i++) scan(n.namedChild(i)!);
  };
  if (body) scan(body);
  return locals;
};

// A `call`/`identifier` invoking a bare method `name` (receiver-less call,
// `self.name` call, or the zero-arg bare-identifier form). `locals` shadows the
// bare-identifier form. Returns the node, else null.
const selfCallNode = (
  n: Node,
  name: string,
  locals: Set<string>,
): Node | null => {
  if (n.type === "call") {
    const recv = n.childForFieldName("receiver");
    if (
      n.childForFieldName("method")?.text === name &&
      (recv === null || recv.type === "self")
    ) {
      return n;
    }
  }
  if (n.type === "identifier" && n.text === name && !locals.has(name)) {
    const p = n.parent;
    const isMethodName = p?.type === "call" &&
      p.childForFieldName("method")?.id === n.id;
    if (!isMethodName) return n;
  }
  for (let i = 0; i < n.namedChildCount; i++) {
    const hit = selfCallNode(n.namedChild(i)!, name, locals);
    if (hit) return hit;
  }
  return null;
};

/** A method that directly calls itself. Note the 60fps mruby-stack risk. Gate:
 * exact same-name self-call (receiver-less, `self.`, or bare-identifier form),
 * shadow-guarded. Fires once per def, anchored at the first self-call. */
export const recursionRule = (node: Node, out: unknown[], sev: SeverityAt) => {
  if (node.type !== "method" && node.type !== "singleton_method") return;
  const name = node.childForFieldName("name")?.text;
  const body = node.childForFieldName("body");
  if (!name || !body) return;
  const hit = selfCallNode(body, name, localNamesIn(node));
  if (!hit) return;
  out.push({
    range: nodeRange(hit),
    severity: sev(node),
    source: "drenv",
    code: "recursion",
    codeDescription: { href: RECURSION },
    message: `\`${name}\` calls itself — deep recursion risks exhausting ` +
      `mruby's stack at 60fps; prefer an iterative loop. ` +
      `See: Troubleshoot Performance → Recursion.`,
  });
};

/** A block-form `.map` standing as a non-final statement whose result is
 * discarded — `.each` expresses the intent. Structural: the `map` call sits in
 * a statement-list parent and has a following sibling (so it is not the block's
 * return value). */
export const unusedMapRule = (node: Node, out: unknown[], sev: SeverityAt) => {
  if (node.type !== "call") return;
  if (node.childForFieldName("method")?.text !== "map") return;
  const block = node.childForFieldName("block");
  if (block?.type !== "block" && block?.type !== "do_block") return;
  const parent = node.parent;
  if (!parent || !STATEMENT_PARENTS.has(parent.type)) return;
  if (!node.nextNamedSibling) return;
  out.push({
    range: nodeRange(node),
    severity: sev(node),
    source: "drenv",
    code: "unused-map",
    codeDescription: { href: RENDERING_PRIMITIVES },
    message: `\`.map\` discards its result here (non-final statement) — use ` +
      `\`.each\` when you don't need the returned Array. ` +
      `See: Troubleshoot Performance → Rendering Primitives.`,
  });
};

/** Name-keyed tick call graph over the workspace def index. Roots are every
 * method named `tick`; edges follow self-calls (receiver-less / `self.` / bare
 * identifier) by name. Name-level resolution deliberately over-links, which
 * only widens reachability — the conservative direction (keeps more hints at
 * Information rather than softening them). Computed once per diagnostics pass. */
export const tickReachability = (ws: Workspace): SeverityAt => {
  const defNames = new Set<string>();
  for (const [name, locs] of ws.defs) {
    if (locs.some((l) => l.kind === "method")) defNames.add(name);
  }

  const edges = new Map<string, Set<string>>();
  const called = new Set<string>();

  const addMethod = (methodNode: Node) => {
    const name = methodNode.childForFieldName("name")?.text;
    const body = methodNode.childForFieldName("body");
    if (!name || !body) return;
    const locals = localNamesIn(methodNode);
    const targets = edges.get(name) ?? new Set<string>();

    const scan = (n: Node) => {
      let target: string | null = null;
      if (n.type === "call") {
        const recv = n.childForFieldName("receiver");
        const m = n.childForFieldName("method")?.text;
        if (m && (recv === null || recv.type === "self")) target = m;
      } else if (n.type === "identifier") {
        const p = n.parent;
        const isMethodName = p?.type === "call" &&
          p.childForFieldName("method")?.id === n.id;
        if (!isMethodName && defNames.has(n.text) && !locals.has(n.text)) {
          target = n.text;
        }
      }
      if (target && defNames.has(target)) {
        targets.add(target);
        called.add(target);
      }
      for (let i = 0; i < n.namedChildCount; i++) scan(n.namedChild(i)!);
    };
    scan(body);
    edges.set(name, targets);
  };

  const walkMethods = (n: Node) => {
    if (n.type === "method" || n.type === "singleton_method") addMethod(n);
    for (let i = 0; i < n.namedChildCount; i++) walkMethods(n.namedChild(i)!);
  };
  for (const uri of ws.fileUris()) {
    const tree = ws.fileTree(uri);
    if (tree) walkMethods(tree.rootNode);
  }

  const reachable = new Set<string>();
  if (defNames.has("tick")) {
    const queue = ["tick"];
    reachable.add("tick");
    while (queue.length) {
      const cur = queue.shift()!;
      for (const next of edges.get(cur) ?? []) {
        if (!reachable.has(next)) {
          reachable.add(next);
          queue.push(next);
        }
      }
    }
  }

  return (node: Node): Severity => {
    let name: string | undefined;
    for (let p: Node | null = node; p; p = p.parent) {
      if (p.type === "method" || p.type === "singleton_method") {
        name = p.childForFieldName("name")?.text;
        break;
      }
    }
    if (name === undefined) return 3; // top-level firing — it runs
    if (reachable.has(name)) return 3; // hot path
    if (called.has(name)) return 4; // invoked, not provably per-frame — soften
    return 3; // no known callers — cannot prove cold
  };
};
