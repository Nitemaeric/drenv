// drenv lsp — SPIKE. A minimal DragonRuby language server over stdio.
// Proves: tree-sitter-ruby (wasm) in Deno, engine-derived API intelligence,
// and the core LSP surface (completion, hover, definition/references,
// syntax + method-validity diagnostics). Not production code.
import { Language, Node, Parser, Tree } from "npm:web-tree-sitter@0.25.3";
import { walk } from "@std/fs";
import { fromFileUrl, join, resolve, toFileUrl } from "@std/path";

import { versionsPath } from "../constants.ts";
import { installedVersions } from "../utils/installed-versions.ts";
import { readLock } from "../utils/lockfile.ts";

// --- tree-sitter setup (all bytes, so `deno compile --include` just works) ---

let parser: Parser;

const initParser = async () => {
  const wasm = (name: string) =>
    Deno.readFile(new URL(`./vendor/${name}`, import.meta.url));
  await Parser.init({ wasmBinary: await wasm("tree-sitter.wasm") });
  const ruby = await Language.load(await wasm("tree-sitter-ruby.wasm"));
  parser = new Parser();
  parser.setLanguage(ruby);
};

// --- engine API index (derived from the installed DragonRuby) ---------------

type Param = {
  label: string;
  name: string;
  kind: "required" | "optional" | "rest" | "keyword" | "keyword_optional";
  /** Geometric attributes the engine's own body reads off this parameter. */
  shape?: string[];
};

// Only geometric attrs count toward a duck shape, so incidental calls the
// body makes on a param (.merge, .to_radians, ...) don't produce demands.
const GEOM_ATTRS = new Set([
  "x",
  "y",
  "w",
  "h",
  "x2",
  "y2",
  "r",
  "radius",
  "cx",
  "cy",
  "anchor_x",
  "anchor_y",
]);
type ApiEntry = {
  label: string;
  doc: string;
  params?: Param[];
  signature?: string;
};

const extractParams = (method: Node): Param[] => {
  const parameters = method.childForFieldName("parameters");
  if (!parameters) return [];

  const params: Param[] = [];
  const named = (child: Node) =>
    child.childForFieldName("name")?.text ?? child.text;

  for (let i = 0; i < parameters.namedChildCount; i++) {
    const child = parameters.namedChild(i)!;
    switch (child.type) {
      case "identifier":
        params.push({ label: child.text, name: child.text, kind: "required" });
        break;
      case "optional_parameter":
        params.push({
          label: child.text,
          name: named(child),
          kind: "optional",
        });
        break;
      case "keyword_parameter":
        params.push({
          label: child.text,
          name: named(child),
          // A keyword without a default is required at the call site.
          kind: child.childForFieldName("value")
            ? "keyword_optional"
            : "keyword",
        });
        break;
      case "splat_parameter":
      case "hash_splat_parameter":
        params.push({ label: child.text, name: named(child), kind: "rest" });
        break;
        // block parameters aren't part of the positional signature
    }
  }

  deriveShapes(method, params);
  return params;
};

/** Collects the geometric attrs the method body reads off each parameter. */
const deriveShapes = (method: Node, params: Param[]) => {
  const body = method.childForFieldName("body");
  if (!body) return;

  const byName = new Map(params.map((p) => [p.name, new Set<string>()]));
  const reassigned = new Set<string>();

  const scan = (n: Node) => {
    if (n.type === "assignment") {
      const left = n.childForFieldName("left");
      if (left?.type === "identifier") reassigned.add(left.text);
    }
    if (n.type === "call") {
      const receiver = n.childForFieldName("receiver");
      const attr = n.childForFieldName("method");
      const argsNode = n.childForFieldName("arguments");
      if (
        receiver?.type === "identifier" && byName.has(receiver.text) &&
        attr && GEOM_ATTRS.has(attr.text) &&
        (!argsNode || argsNode.namedChildCount === 0)
      ) {
        byName.get(receiver.text)!.add(attr.text);
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) scan(n.namedChild(i)!);
  };
  scan(body);

  for (const param of params) {
    const attrs = byName.get(param.name);
    if (attrs?.size && !reassigned.has(param.name)) {
      param.shape = [...attrs].sort();
    }
  }
};

const renderSignature = (name: string, params: Param[]): string =>
  `${name}(${params.map((p) => p.label).join(", ")})`;

// Receiver chain -> completions. `Geometry`/`Easing` are parsed out of the
// installed engine's own Ruby source; the `args` chains are curated for the
// spike (a full generator is post-spike work).
const api = new Map<string, ApiEntry[]>();
const VALIDITY_RECEIVERS = new Set(["Geometry", "Easing"]);
let engineLabel = "unknown";

const ARGS_CHAINS: Record<string, string[]> = {
  "args": ["state", "inputs", "outputs", "audio", "gtk", "grid", "geometry"],
  "args.inputs": [
    "keyboard",
    "controller_one",
    "controller_two",
    "mouse",
    "touch",
    "left",
    "right",
    "up",
    "down",
    "last_active",
  ],
  "args.outputs": [
    "sprites",
    "solids",
    "labels",
    "lines",
    "borders",
    "primitives",
    "static_sprites",
    "sounds",
    "debug",
  ],
  "args.inputs.keyboard": ["key_down", "key_held", "key_up", "has_focus"],
};

const indexEngineModule = async (dir: string, file: string, name: string) => {
  let text: string;
  try {
    text = await Deno.readTextFile(join(dir, "docs", "oss", "dragon", file));
  } catch {
    return;
  }

  const tree = parser.parse(text)!;
  const entries: ApiEntry[] = [];

  const visit = (node: Node) => {
    if (node.type === "method") {
      const method = node.childForFieldName("name")?.text;
      if (method && !method.startsWith("_")) {
        // Contiguous comment lines directly above the def become the doc.
        const docLines: string[] = [];
        let prev = node.previousNamedSibling;
        while (prev?.type === "comment") {
          docLines.unshift(prev.text.replace(/^#\s?/, ""));
          prev = prev.previousNamedSibling;
        }
        const params = extractParams(node);
        entries.push({
          label: method,
          doc: docLines.join("\n"),
          params,
          signature: renderSignature(method, params),
        });
      }
    }
    for (let i = 0; i < node.namedChildCount; i++) visit(node.namedChild(i)!);
  };
  visit(tree.rootNode);

  if (entries.length > 0) api.set(name, entries);
};

// --- engine markdown docs (the same files docs.dragonruby.org serves) -------

const methodDocs = new Map<string, Map<string, string>>();

const indexDocsFile = async (dir: string, file: string, key: string) => {
  let text: string;
  try {
    text = await Deno.readTextFile(join(dir, "docs", "api", file));
  } catch {
    return;
  }

  const docs = methodDocs.get(key) ?? new Map<string, string>();
  let names: string[] = [];
  let body: string[] = [];

  const flush = () => {
    const doc = body.join("\n").trim();
    for (const name of names) {
      if (doc && !docs.has(name)) docs.set(name, doc);
    }
    names = [];
    body = [];
  };

  for (const line of text.split("\n")) {
    const heading = line.match(/^#{2,3} (.+)$/);
    if (heading) {
      flush();
      // Method names are backticked in headings; skip class-like tokens so
      // category headings ("`Array` Class Methods") don't pollute the index.
      names = [...heading[1].matchAll(/`([a-z_][\w?!]*)`/g)].map((m) => m[1]);
    } else if (names.length) {
      body.push(line);
    }
  }
  flush();

  methodDocs.set(key, docs);
};

// DragonRuby exposes class-level variants of Array iteration methods
// (documented as a bullet list, e.g. `Array.filter_map(collection)`).
const indexArrayClassMethods = async (dir: string) => {
  let text: string;
  try {
    text = await Deno.readTextFile(join(dir, "docs", "api", "array.md"));
  } catch {
    return;
  }

  const section = text.split(/^## `Array` Class Methods$/m)[1];
  if (!section) return;

  const body = section.split(/^#{1,3} /m)[0];
  const instanceDocs = methodDocs.get("Array");
  const entries: ApiEntry[] = [];

  for (const match of body.matchAll(/^- `([\w?!]+)`/gm)) {
    const name = match[1];
    const variant =
      `Class-level variant: \`Array.${name}(collection, ...)\` — ` +
      `like \`#${name}\`, but a bit faster. Assumes the collection isn't ` +
      `mutated during iteration.`;
    const instance = instanceDocs?.get(name);
    entries.push({
      label: name,
      doc: instance ? `${variant}\n\n---\n\n${instance}` : variant,
    });
  }

  if (entries.length > 0) api.set("Array", entries);
};

const buildApiIndex = async () => {
  const version = (await installedVersions())[0];
  if (!version) return;
  engineLabel = version;

  const dir = join(versionsPath, version);
  await indexEngineModule(dir, "geometry.rb", "Geometry");
  await indexEngineModule(dir, "easing.rb", "Easing");

  for (const [chain, members] of Object.entries(ARGS_CHAINS)) {
    api.set(
      chain,
      members.map((label) => ({
        label,
        doc: `DragonRuby \`${chain}.${label}\``,
      })),
    );
  }

  await indexDocsFile(dir, "geometry.md", "Geometry");
  await indexDocsFile(dir, "easing.md", "Easing");
  await indexDocsFile(dir, "array.md", "Array");
  await indexDocsFile(dir, "numeric.md", "Numeric");
  await indexDocsFile(dir, "outputs.md", "args.outputs");
  await indexDocsFile(dir, "inputs.md", "args.inputs");

  await indexArrayClassMethods(dir);

  // Enrich indexed entries with the markdown docs and surface doc-only
  // methods (e.g. C-implemented ones the Ruby source never mentions).
  for (const [key, docs] of methodDocs) {
    const entries = api.get(key);
    if (!entries) continue;
    for (const entry of entries) {
      const doc = docs.get(entry.label);
      if (doc) entry.doc = doc;
    }
    for (const [name, doc] of docs) {
      if (!entries.some((e) => e.label === name)) {
        entries.push({ label: name, doc });
      }
    }
  }
};

// --- workspace index ---------------------------------------------------------

type Location = {
  uri: string;
  range: { start: Pos; end: Pos };
  container?: string; // enclosing namespace, e.g. "Conjuration::Animation"
  kind?: "method" | "class" | "module";
  doc?: string; // raw comment block; rendered lazily
  superclass?: string; // as written at the class site, e.g. "Scene"
};
type Pos = { line: number; character: number };

const defs = new Map<string, Location[]>(); // identifier -> definitions
const fileText = new Map<string, string>(); // uri -> latest text
const fileTree = new Map<string, Tree>();

// --- YARD doc rendering ------------------------------------------------------

/** RDoc inline code markup (`+foo+`) → markdown backticks. */
const inlineMd = (s: string) => s.replace(/\+([^\s+][^+]*?)\+/g, "`$1`");

// Qualified class/module name -> location, rebuilt when the def index moves.
let defsGeneration = 0;
let nsIndexGeneration = -1;
let nsIndex = new Map<string, Location>();
const namespaceIndex = (): Map<string, Location> => {
  if (nsIndexGeneration === defsGeneration) return nsIndex;
  nsIndex = new Map();
  for (const [name, locs] of defs) {
    for (const loc of locs) {
      if (loc.kind === "method" || !loc.kind) continue;
      const qualified = loc.container ? `${loc.container}::${name}` : name;
      if (!nsIndex.has(qualified)) nsIndex.set(qualified, loc);
    }
  }
  nsIndexGeneration = defsGeneration;
  return nsIndex;
};

/** Resolves a constant path the way Ruby/YARD would: relative to the doc's
 * namespace first, walking outward, then top-level. */
const resolveConstName = (path: string, container: string): string | null => {
  const ns = namespaceIndex();
  const parts = container ? container.split("::") : [];
  for (let i = parts.length; i >= 0; i--) {
    const prefix = parts.slice(0, i).join("::");
    const key = prefix ? `${prefix}::${path}` : path;
    if (ns.has(key)) return key;
  }
  return null;
};

const resolveConst = (path: string, container: string): Location | null => {
  const key = resolveConstName(path, container);
  return key ? namespaceIndex().get(key) ?? null : null;
};

const constLink = (path: string, hit: Location): string =>
  `[\`${path}\`](${hit.uri}#L${hit.range.start.line + 1})`;

/** Renders a YARD type list (`[Animation, nil]`), linking each alternative
 * that resolves to a workspace class or module. */
const renderType = (type: string, container: string): string =>
  type.split(",").map((part) => {
    const t = part.trim();
    const hit = /^[A-Z]\w*(::[A-Z]\w*)*$/.test(t)
      ? resolveConst(t, container)
      : null;
    return hit ? constLink(t, hit) : `\`${t}\``;
  }).join(", ");

/** Resolves a `@see Some::Const` reference to a markdown link when the
 * constant exists in the workspace index. */
const seeLink = (rest: string, container: string): string => {
  const target = rest.trim().split(/\s+/)[0] ?? "";
  const hit = /^[A-Z]\w*(::[A-Z]\w*)*$/.test(target)
    ? resolveConst(target, container)
    : null;
  if (!hit) return `_See:_ ${inlineMd(rest)}`;
  const trailing = rest.trim().slice(target.length);
  return `_See:_ ${constLink(target, hit)}${inlineMd(trailing)}`;
};

const renderCache = new Map<string, string>();

/** Renders a raw comment block (plain or YARD-tagged) as markdown. Constant
 * references resolve relative to `container`, the doc's enclosing namespace. */
const renderDoc = (raw: string, container = ""): string => {
  const cacheKey = `${container}\u0000${raw}`;
  const cached = renderCache.get(cacheKey);
  if (cached) return cached;

  const intro: string[] = [];
  const params: string[] = [];
  const yields: string[] = [];
  const raises: string[] = [];
  const extras: string[] = [];
  const examples: string[][] = [];
  let returns = "";
  let example: string[] | null = null;
  let continuation: { arr: string[]; quote: boolean } | null = null;

  const typed = (rest: string): string => {
    const r = rest.match(/^(?:\[([^\]]*)\])?\s*(.*)$/);
    return r
      ? `${r[1] ? `(${renderType(r[1], container)}) ` : ""}${
        inlineMd(r[2] ?? "")
      }`
      : inlineMd(rest);
  };

  for (const line of raw.split("\n")) {
    if (example) {
      if (line.startsWith("  ") || line.trim() === "") {
        example.push(line.replace(/^  /, ""));
        continue;
      }
      example = null;
    }

    const tag = line.match(/^@(\w+)\s*(.*)$/);
    if (!tag) {
      if (continuation && line.startsWith("  ")) {
        const text = inlineMd(line.trim());
        continuation.arr[continuation.arr.length - 1] += continuation.quote
          ? `\n> ${text}`
          : ` ${text}`;
        continue;
      }
      continuation = null;
      intro.push(inlineMd(line));
      continue;
    }

    const [, name, rest] = tag;
    continuation = null;
    switch (name) {
      case "example":
        example = [];
        examples.push(example);
        break;
      case "param": {
        const p = rest.match(/^(\S+)\s*(?:\[([^\]]*)\])?\s*(.*)$/);
        if (p) {
          params.push(
            `- \`${p[1]}\`${p[2] ? ` (${renderType(p[2], container)})` : ""}${
              p[3] ? ` — ${inlineMd(p[3])}` : ""
            }`,
          );
          continuation = { arr: params, quote: false };
        }
        break;
      }
      case "return":
        returns = typed(rest);
        break;
      case "yield":
        yields.push(`**Yields** ${typed(rest)}`);
        continuation = { arr: yields, quote: false };
        break;
      case "yieldparam": {
        const p = rest.match(/^(\S+)\s*(?:\[([^\]]*)\])?\s*(.*)$/);
        if (p) {
          yields.push(
            `- \`${p[1]}\`${p[2] ? ` (${renderType(p[2], container)})` : ""}${
              p[3] ? ` — ${inlineMd(p[3])}` : ""
            }`,
          );
          continuation = { arr: yields, quote: false };
        }
        break;
      }
      case "yieldreturn":
        yields.push(`**Yield returns** ${typed(rest)}`);
        break;
      case "raise":
        raises.push(typed(rest));
        break;
      case "note":
        extras.push(`> **Note:** ${inlineMd(rest)}`);
        continuation = { arr: extras, quote: true };
        break;
      case "deprecated":
        extras.push(`> **Deprecated.** ${inlineMd(rest)}`);
        continuation = { arr: extras, quote: true };
        break;
      case "see":
        extras.push(seeLink(rest, container));
        break;
      default:
        extras.push(`_@${name}_ ${inlineMd(rest)}`);
    }
  }

  const sections = [intro.join("\n").trim()];
  if (params.length) sections.push(`**Parameters**\n${params.join("\n")}`);
  if (returns) sections.push(`**Returns** ${returns}`);
  if (yields.length) sections.push(yields.join("\n"));
  if (raises.length) {
    sections.push(raises.map((r) => `**Raises** ${r}`).join("\n\n"));
  }
  if (extras.length) sections.push(extras.join("\n\n"));
  for (const code of examples) {
    const body = code.join("\n").trim();
    if (body) sections.push("```ruby\n" + body + "\n```");
  }
  const out = sections.filter((s) => s.length > 0).join("\n\n");
  renderCache.set(cacheKey, out);
  return out;
};

const nodeRange = (node: Node) => ({
  start: { line: node.startPosition.row, character: node.startPosition.column },
  end: { line: node.endPosition.row, character: node.endPosition.column },
});

const indexFile = (uri: string, text: string) => {
  defsGeneration++;
  fileText.set(uri, text);
  const tree = parser.parse(text)!;
  fileTree.set(uri, tree);
  const lines = text.split("\n");

  // Drop this file's old definitions, then re-add.
  for (const [name, locs] of defs) {
    const kept = locs.filter((loc) => loc.uri !== uri);
    if (kept.length > 0) defs.set(name, kept);
    else defs.delete(name);
  }

  // Comments aren't reliably tree siblings of the def they document (a
  // class's doc block can attach to the enclosing module node), so walk
  // raw lines upward instead.
  const docAbove = (row: number): string | undefined => {
    const docLines: string[] = [];
    for (let r = row - 1; r >= 0; r--) {
      const trimmed = lines[r].trim();
      if (!trimmed.startsWith("#")) break;
      docLines.unshift(trimmed.replace(/^#[ ]?/, ""));
    }
    return docLines.length > 0 ? docLines.join("\n") : undefined;
  };

  const addDef = (name: string, loc: Location) => {
    const list = defs.get(name) ?? [];
    list.push(loc);
    defs.set(name, list);
  };

  const ATTRS = new Set(["attr_reader", "attr_writer", "attr_accessor"]);

  const visit = (node: Node, container: string) => {
    let inner = container;
    if (["method", "class", "module"].includes(node.type)) {
      const name = node.childForFieldName("name");
      if (name) {
        addDef(name.text, {
          uri,
          range: nodeRange(name),
          kind: node.type as Location["kind"],
          container: container || undefined,
          doc: docAbove(node.startPosition.row),
          superclass: node.type === "class"
            ? node.childForFieldName("superclass")?.namedChild(0)?.text
            : undefined,
        });

        if (node.type !== "method") {
          inner = container ? `${container}::${name.text}` : name.text;
        }
      }
    }

    // attr_reader :x, :y and friends define methods too.
    if (
      node.type === "call" && !node.childForFieldName("receiver") &&
      ATTRS.has(node.childForFieldName("method")?.text ?? "")
    ) {
      const doc = docAbove(node.startPosition.row);
      const argsNode = node.childForFieldName("arguments");
      for (let i = 0; i < (argsNode?.namedChildCount ?? 0); i++) {
        const arg = argsNode!.namedChild(i)!;
        if (arg.type !== "simple_symbol") continue;
        addDef(arg.text.slice(1), {
          uri,
          range: nodeRange(arg),
          kind: "method",
          container: container || undefined,
          doc,
        });
      }
    }

    for (let i = 0; i < node.namedChildCount; i++) {
      visit(node.namedChild(i)!, inner);
    }
  };
  visit(tree.rootNode, "");
  return tree;
};

const indexTree = async (dir: string) => {
  try {
    for await (
      const entry of walk(dir, { exts: [".rb"], includeDirs: false })
    ) {
      indexFile(
        toFileUrl(entry.path).href,
        await Deno.readTextFile(entry.path),
      );
    }
  } catch {
    // Directory doesn't exist in this project shape — fine.
  }
};

/**
 * Vendored packages whose `path:` source resolves to another indexed project
 * root are twins of workspace source (the vendored copy is a build artifact —
 * drenv re-syncs it from the source). Skip them so definitions point at the
 * one true copy, the one that's safe to edit.
 */
const vendorSkips = async (
  base: string,
  indexedRoots: Set<string>,
): Promise<Set<string>> => {
  const skips = new Set<string>();
  const lock = await readLock(join(base, "drenv.lock")).catch(() => null);

  for (const dep of lock?.dependencies ?? []) {
    if (!dep.source.startsWith("path:")) continue;
    const source = resolve(base, dep.source.slice("path:".length));
    if (indexedRoots.has(source)) {
      skips.add(dep.name);
      console.error(
        `drenv-lsp: '${dep.name}' vendored from workspace source ${source} — indexing the source only`,
      );
    }
  }
  return skips;
};

const scanWorkspace = async (root: string, indexedRoots: Set<string>) => {
  for (const sub of ["mygame/app", "app", "lib"]) {
    await indexTree(join(root, sub));
  }

  for (const base of [join(root, "mygame"), root]) {
    const vendor = join(base, "vendor");
    let entries: Deno.DirEntry[];
    try {
      entries = await Array.fromAsync(Deno.readDir(vendor));
    } catch {
      continue;
    }

    const skips = await vendorSkips(base, indexedRoots);
    for (const entry of entries) {
      if (entry.isDirectory && !skips.has(entry.name)) {
        await indexTree(join(vendor, entry.name));
      }
    }
  }
};

// --- diagnostics --------------------------------------------------------------

// --- performance hints (from the engine's troubleshoot-performance guide) ---

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

const PERF_GUIDE =
  "https://docs.dragonruby.org/#/guides/troubleshoot-performance?id=array-manipulation";

// Flags mutation of a collection inside its own `.each` block — the guide's
// "Array Manipulation" antipattern (collect changes, apply after the loop).
const mutationDuringIteration = (node: Node, out: unknown[]) => {
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

const diagnostics = (uri: string): unknown[] => {
  const tree = fileTree.get(uri);
  if (!tree) return [];
  const out: unknown[] = [];

  const visit = (node: Node) => {
    if (node.type === "ERROR" || node.isMissing) {
      out.push({
        range: nodeRange(node),
        severity: 1,
        source: "drenv",
        message: node.isMissing
          ? `syntax error: missing ${node.type}`
          : "syntax error",
      });
    }

    // Method validity — only asserted for receivers whose complete surface
    // we own (engine modules). `Array` etc. have core class methods beyond
    // the documented variants, so they get completions but never warnings.
    if (node.type === "call") {
      const receiver = node.childForFieldName("receiver");
      const method = node.childForFieldName("method");
      const known = receiver?.type === "constant" &&
        VALIDITY_RECEIVERS.has(receiver.text) && api.get(receiver.text);
      if (known && method && !known.some((e) => e.label === method.text)) {
        out.push({
          range: nodeRange(method),
          severity: 2,
          source: "drenv",
          message: `\`${method.text}\` is not a method on ${
            receiver!.text
          } (DragonRuby ${engineLabel})`,
        });
      } else if (known && method) {
        const entry = known.find((e) => e.label === method.text);
        const argsNode = node.childForFieldName("arguments");
        if (entry?.params && argsNode) {
          const all: Node[] = [];
          for (let i = 0; i < argsNode.namedChildCount; i++) {
            const child = argsNode.namedChild(i)!;
            if (child.type !== "block_argument") all.push(child);
          }

          const keywords = entry.params.filter((p) =>
            p.kind === "keyword" || p.kind === "keyword_optional"
          );
          const positionalParams = entry.params.filter((p) =>
            p.kind === "required" || p.kind === "optional" || p.kind === "rest"
          );

          // A hash-literal must carry the geometric attrs the engine's own
          // body reads off the parameter. Literals only — variables would
          // need type inference.
          const shapeCheck = (arg: Node, param: Param, where: string) => {
            if (arg.type !== "hash" || !param.shape) return;
            const keys = new Set<string>();
            let splat = false;
            for (let j = 0; j < arg.namedChildCount; j++) {
              const pair = arg.namedChild(j)!;
              if (pair.type !== "pair") {
                splat = true;
                break;
              }
              const key = pair.childForFieldName("key");
              if (key) keys.add(key.text.replace(/:$/, ""));
            }
            if (splat || keys.size === 0) return;
            const missing = param.shape.filter((attr) => !keys.has(attr));
            if (missing.length > 0) {
              out.push({
                range: nodeRange(arg),
                severity: 2,
                source: "drenv",
                message: `${where} (\`${param.name}\`) is missing ` +
                  missing.map((m) => `\`.${m}\``).join(", ") +
                  ` — ${receiver!.text}.${method.text} reads ` +
                  param.shape.map((s) => `${param.name}.${s}`).join(", "),
              });
            }
          };

          const arityError = (count: number) => {
            const required = positionalParams.filter((p) =>
              p.kind === "required"
            ).length;
            const hasRest = positionalParams.some((p) => p.kind === "rest");
            const max = hasRest ? Infinity : positionalParams.length;
            if (count >= required && count <= max) return;
            const expected = hasRest
              ? `at least ${required}`
              : required === positionalParams.length
              ? `${required}`
              : `${required}..${positionalParams.length}`;
            out.push({
              range: nodeRange(argsNode),
              severity: 2,
              source: "drenv",
              message: `${receiver!.text}.${method.text} expects ${expected} ` +
                `positional argument(s) — \`${entry.signature}\` — got ${count}`,
            });
          };

          if (keywords.length > 0) {
            // Bare pairs are kwargs: validate names, required presence, and
            // hash-literal values against the parameter's derived shape.
            const pairs = all.filter((c) => c.type === "pair");
            const positionalArgs = all.filter((c) => c.type !== "pair");
            const given = new Set<string>();

            for (const pair of pairs) {
              const key = pair.childForFieldName("key")?.text.replace(/:$/, "");
              if (!key) continue;
              given.add(key);
              const param = keywords.find((k) => k.name === key);
              if (!param) {
                out.push({
                  range: nodeRange(pair),
                  severity: 2,
                  source: "drenv",
                  message: `\`${key}:\` is not a keyword of ` +
                    `${receiver!.text}.${method.text} — accepted: ` +
                    keywords.map((k) => `${k.name}:`).join(", "),
                });
              } else {
                const value = pair.childForFieldName("value");
                if (value) shapeCheck(value, param, `keyword \`${key}:\``);
              }
            }

            const missingRequired = keywords.filter((k) =>
              k.kind === "keyword" && !given.has(k.name)
            );
            if (missingRequired.length > 0) {
              out.push({
                range: nodeRange(argsNode),
                severity: 2,
                source: "drenv",
                message: `${receiver!.text}.${method.text} is missing ` +
                  `required keyword(s) ` +
                  missingRequired.map((k) => `\`${k.name}:\``).join(", ") +
                  ` — \`${entry.signature}\``,
              });
            }

            arityError(positionalArgs.length);
          } else {
            // Contiguous trailing pairs collapse into one options hash.
            const children = [...all];
            while (
              children.length > 1 &&
              children[children.length - 1].type === "pair" &&
              children[children.length - 2].type === "pair"
            ) {
              children.pop();
            }
            const nonRest = positionalParams.filter((p) => p.kind !== "rest");
            for (let i = 0; i < children.length && i < nonRest.length; i++) {
              shapeCheck(children[i], nonRest[i], `argument ${i + 1}`);
            }
            arityError(children.length);
          }
        }
      }
    }

    mutationDuringIteration(node, out);

    for (let i = 0; i < node.namedChildCount; i++) visit(node.namedChild(i)!);
  };
  visit(tree.rootNode);
  return out;
};

// --- mruby core index (spike: curated; production generates from mruby src) --

const CORE_METHODS: Record<string, string[]> = {
  Array: [
    "each",
    "each_with_index",
    "map",
    "map!",
    "select",
    "reject",
    "reduce",
    "inject",
    "find",
    "include?",
    "length",
    "size",
    "count",
    "first",
    "last",
    "push",
    "pop",
    "shift",
    "unshift",
    "flatten",
    "compact",
    "uniq",
    "sort",
    "sort_by",
    "min",
    "max",
    "min_by",
    "max_by",
    "sum",
    "zip",
    "take",
    "drop",
    "empty?",
    "any?",
    "all?",
    "none?",
    "sample",
    "shuffle",
    "reverse",
    "join",
    "index",
    "delete",
    "delete_if",
    "concat",
    "each_slice",
    "group_by",
    "partition",
    "flat_map",
  ],
  Hash: [
    "each",
    "each_pair",
    "keys",
    "values",
    "map",
    "merge",
    "merge!",
    "select",
    "reject",
    "fetch",
    "store",
    "delete",
    "key?",
    "has_key?",
    "include?",
    "value?",
    "empty?",
    "length",
    "size",
    "any?",
    "all?",
    "to_a",
    "invert",
    "dig",
    "update",
    "find",
    "count",
    "sort_by",
    "min_by",
    "max_by",
    "sum",
  ],
  String: [
    "length",
    "size",
    "split",
    "sub",
    "gsub",
    "strip",
    "chomp",
    "upcase",
    "downcase",
    "capitalize",
    "include?",
    "start_with?",
    "end_with?",
    "index",
    "slice",
    "chars",
    "bytes",
    "lines",
    "to_i",
    "to_f",
    "to_s",
    "to_sym",
    "empty?",
    "reverse",
    "concat",
    "ljust",
    "rjust",
    "each_char",
    "each_line",
  ],
  Numeric: [
    "times",
    "upto",
    "downto",
    "step",
    "abs",
    "ceil",
    "floor",
    "round",
    "to_i",
    "to_f",
    "to_s",
    "zero?",
    "positive?",
    "negative?",
    "even?",
    "odd?",
    "clamp",
    "between?",
    "divmod",
    "succ",
    "pred",
    // DragonRuby Numeric extensions:
    "lerp",
    "remap",
    "frame_index",
    "elapsed?",
    "vector_x",
    "vector_y",
    "to_radians",
    "to_degrees",
  ],
};

// A literal receiver names its class outright — no inference needed.
const literalClass = (prefix: string): string | null => {
  const lit = prefix.match(/(\]|\}|"|'|\d)\s*\.\s*\w*$/)?.[1];
  if (!lit) return null;
  if (lit === "]") return "Array";
  if (lit === "}") return "Hash";
  if (lit === '"' || lit === "'") return "String";
  return "Numeric";
};

// --- language features ---------------------------------------------------------

const lineUpTo = (uri: string, pos: Pos): string => {
  const text = fileText.get(uri) ?? "";
  const line = text.split("\n")[pos.line] ?? "";
  return line.slice(0, pos.character);
};

const completions = (uri: string, pos: Pos): unknown[] => {
  const prefix = lineUpTo(uri, pos);
  const chain = prefix.match(/([A-Za-z_][\w.]*)\.\s*[\w]*$/)?.[1];

  if (chain) {
    const entries = api.get(chain);
    if (entries) {
      return entries.map((e) => ({
        label: e.label,
        kind: 2, // Method
        detail: e.signature,
        documentation: { kind: "markdown", value: e.doc },
      }));
    }
  }

  const cls = literalClass(prefix);
  if (cls) {
    const docs = methodDocs.get(cls);
    const labels = new Set(CORE_METHODS[cls]);
    for (const name of docs?.keys() ?? []) labels.add(name);
    return [...labels].map((label) => ({
      label,
      kind: 2, // Method
      documentation: {
        kind: "markdown",
        value: docs?.get(label) ?? `mruby \`${cls}#${label}\``,
      },
    }));
  }

  // Fall back to workspace definitions + engine top-levels. Docs attach only
  // when unambiguous (same-named defs can document different things).
  const items: unknown[] = [...defs.entries()].map(([name, locs]) => {
    const docs = [...new Set(locs.map((l) => l.doc).filter(Boolean))];
    const documented = locs.find((l) => l.doc);
    return {
      label: name,
      kind: 3, // Function
      ...(docs.length === 1
        ? {
          documentation: {
            kind: "markdown",
            value: renderDoc(docs[0]!, documented?.container ?? ""),
          },
        }
        : {}),
    };
  });
  for (const mod of ["Geometry", "Easing"]) {
    if (api.has(mod)) items.push({ label: mod, kind: 9 }); // Module
  }
  return items;
};

// --- local variable / parameter resolution -----------------------------------

const enclosingNamespace = (n: Node): string => {
  const parts: string[] = [];
  for (let p = n.parent; p; p = p.parent) {
    if (p.type === "class" || p.type === "module") {
      const name = p.childForFieldName("name")?.text;
      if (name) parts.unshift(name);
    }
  }
  return parts.join("::");
};

type LocalHit = {
  role: string;
  node: Node;
  method: Node;
  methodLabel: string;
};

/** When the identifier at `pos` is a parameter, block parameter, or local
 * variable of its enclosing method, workspace-wide name matches are noise —
 * resolve it locally instead. */
const resolveLocal = (uri: string, pos: Pos, word: string): LocalHit | null => {
  const tree = fileTree.get(uri);
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
  const ns = enclosingNamespace(method);
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
};

const wordAt = (uri: string, pos: Pos): string | null => {
  const text = fileText.get(uri) ?? "";
  const line = text.split("\n")[pos.line] ?? "";
  const before = line.slice(0, pos.character).match(/[\w?!]*$/)?.[0] ?? "";
  const after = line.slice(pos.character).match(/^[\w?!]*/)?.[0] ?? "";
  const word = before + after;
  return word || null;
};

/** Ranks a bare call's candidate definitions by the call site's enclosing
 * class, its superclass chain, then same-file — Ruby's own lookup order,
 * approximately. */
const contextCandidates = (
  uri: string,
  pos: Pos,
  found: Location[],
): Location[] | null => {
  const tree = fileTree.get(uri);
  const node = tree?.rootNode.descendantForPosition({
    row: pos.line,
    column: pos.character,
  });
  if (!node) return null;

  let ns = enclosingNamespace(node);
  const seen = new Set<string>();
  while (ns && !seen.has(ns)) {
    seen.add(ns);
    const hits = found.filter((f) => f.container === ns);
    if (hits.length > 0) return hits;
    const cls = namespaceIndex().get(ns);
    ns = cls?.superclass
      ? resolveConstName(
        cls.superclass,
        ns.split("::").slice(0, -1).join("::"),
      ) ?? ""
      : "";
  }

  const inFile = found.filter((f) => f.uri === uri);
  return inFile.length > 0 ? inFile : null;
};

const hover = (uri: string, pos: Pos): unknown => {
  const md = (value: string) => ({ contents: { kind: "markdown", value } });

  // Instance/class variables resolve by enclosing class, not by name.
  const nodeAt = fileTree.get(uri)?.rootNode.descendantForPosition({
    row: pos.line,
    column: pos.character,
  });
  if (
    nodeAt &&
    (nodeAt.type === "instance_variable" || nodeAt.type === "class_variable")
  ) {
    const ns = enclosingNamespace(nodeAt);
    const kindLabel = nodeAt.type === "instance_variable"
      ? "instance variable"
      : "class variable";
    // A documented same-named attr_* in the same class is this variable's doc.
    const attr = (defs.get(nodeAt.text.replace(/^@+/, "")) ?? []).find((f) =>
      f.container === ns && f.kind === "method" && f.doc
    );
    return md(
      `**${nodeAt.text}** — ${kindLabel}${ns ? ` of \`${ns}\`` : ""}` +
        (attr?.doc ? `\n\n---\n\n${renderDoc(attr.doc, ns)}` : ""),
    );
  }

  const word = wordAt(uri, pos);
  if (!word) return null;

  // Engine API doc?
  const line = fileText.get(uri)?.split("\n")[pos.line] ?? "";
  for (const [chain, entries] of api) {
    const entry = entries.find((e) => e.label === word);
    if (entry && line.includes(`${chain.split(".").pop()}.${word}`)) {
      return {
        contents: {
          kind: "markdown",
          value:
            `**${chain}.${word}** — DragonRuby ${engineLabel}\n\n${entry.doc}`,
        },
      };
    }
  }

  // Parameter or local variable of the enclosing method?
  const local = resolveLocal(uri, pos, word);
  if (local) {
    // A parameter's doc is its @param entry in the method's comment block.
    let paramDoc = "";
    if (local.role === "parameter") {
      const lines = (fileText.get(uri) ?? "").split("\n");
      const raw: string[] = [];
      for (let r = local.method.startPosition.row - 1; r >= 0; r--) {
        const trimmed = lines[r].trim();
        if (!trimmed.startsWith("#")) break;
        raw.unshift(trimmed.replace(/^#[ ]?/, ""));
      }
      const rx = new RegExp(
        `^@param ${word}\\b\\s*(?:\\[([^\\]]*)\\])?\\s*(.*)$`,
      );
      for (let i = 0; i < raw.length; i++) {
        const m = raw[i].match(rx);
        if (!m) continue;
        const parts = [m[2] ?? ""];
        for (
          let j = i + 1;
          j < raw.length && raw[j].startsWith(" ") && !raw[j].startsWith("@");
          j++
        ) {
          parts.push(raw[j].trim());
        }
        const ns = enclosingNamespace(local.method);
        paramDoc = `\n\n---\n\n${m[1] ? `(${renderType(m[1], ns)}) ` : ""}${
          inlineMd(parts.join(" ").trim())
        }`;
        break;
      }
    }
    return md(
      `**${word}** — ${local.role} of \`${local.methodLabel}\`${paramDoc}`,
    );
  }

  // Workspace definition?
  const found = defs.get(word);
  if (found?.length) {
    const rel = (u: string) => fromFileUrl(u).split("/").slice(-2).join("/");
    const qualified = (f: Location) =>
      f.container
        ? `${f.container}${f.kind === "method" ? "#" : "::"}${word}`
        : word;

    // Hovering the def itself pins down exactly which one it is.
    const at = found.find((f) =>
      f.uri === uri && f.range.start.line === pos.line &&
      pos.character >= f.range.start.character &&
      pos.character <= f.range.end.character
    );
    if (at) {
      return md(
        `**${qualified(at)}** — defined in ${rel(at.uri)}` +
          (at.doc ? `\n\n---\n\n${renderDoc(at.doc, at.container ?? "")}` : ""),
      );
    }

    // A bare call inside a class resolves like Ruby would: own class first,
    // then up the superclass chain, then same-file.
    let candidates = found;
    if (new Set(found.map(qualified)).size > 1) {
      candidates = contextCandidates(uri, pos, found) ?? found;
    }

    // One qualified name (possibly reopened across files): collapse.
    const names = [...new Set(candidates.map(qualified))];
    if (names.length === 1) {
      const files = [...new Set(candidates.map((f) => rel(f.uri)))];
      const where = files.slice(0, 3).join(", ") +
        (files.length > 3 ? ` (+${files.length - 3} more)` : "");
      const documented = candidates.find((f) => f.doc);
      const docs = [...new Set(candidates.map((f) => f.doc).filter(Boolean))];
      return md(
        `**${names[0]}** — defined in ${where}` +
          (docs.length === 1
            ? `\n\n---\n\n${renderDoc(docs[0]!, documented?.container ?? "")}`
            : ""),
      );
    }

    // Ambiguous call site: list candidates instead of guessing a doc.
    const listed = candidates.slice(0, 5).map((f) =>
      `- \`${qualified(f)}\` — ${rel(f.uri)}`
    );
    const more = candidates.length > 5
      ? `\n- …and ${candidates.length - 5} more`
      : "";
    return md(
      `**${word}** — ${candidates.length} definitions\n\n${
        listed.join("\n")
      }${more}`,
    );
  }
  return null;
};

const definition = (uri: string, pos: Pos): unknown[] => {
  const word = wordAt(uri, pos);
  if (!word) return [];
  const local = resolveLocal(uri, pos, word);
  if (local) return [{ uri, range: nodeRange(local.node) }];
  const found = defs.get(word) ?? [];
  const narrowed = found.length > 1
    ? contextCandidates(uri, pos, found) ?? found
    : found;
  return narrowed.map(({ uri, range }) => ({ uri, range }));
};

const references = (uri: string, pos: Pos): Location[] => {
  const word = wordAt(uri, pos);
  if (!word) return [];

  // A local's references live inside its method, not across the workspace.
  const local = resolveLocal(uri, pos, word);
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

  const out: Location[] = [];
  const pattern = new RegExp(`\\b${word.replace(/[?!]/g, "\\$&")}\\b`, "g");
  for (const [fileUri, text] of fileText) {
    if (scope && fileUri !== scope.uri) continue;
    const lines = text.split("\n");
    for (let line = 0; line < lines.length; line++) {
      if (scope && (line < scope.from || line > scope.to)) continue;
      for (const match of lines[line].matchAll(pattern)) {
        out.push({
          uri: fileUri,
          range: {
            start: { line, character: match.index },
            end: { line, character: match.index + word.length },
          },
        });
      }
    }
  }
  return out;
};

// --- signature help ------------------------------------------------------------

const entryFor = (receiver: string, method: string): ApiEntry | undefined =>
  api.get(receiver)?.find((e) => e.label === method);

const beforeOrAt = (a: Pos, row: number, column: number): boolean =>
  row < a.line || (row === a.line && column <= a.character);

const signatureHelp = (uri: string, pos: Pos): unknown => {
  const tree = fileTree.get(uri);
  if (!tree) return null;

  let node: Node | null = tree.rootNode.descendantForPosition({
    row: pos.line,
    column: Math.max(0, pos.character - 1),
  });
  while (node && node.type !== "call") node = node.parent;
  if (!node) return null;

  const receiver = node.childForFieldName("receiver")?.text;
  const method = node.childForFieldName("method")?.text;
  if (!receiver || !method) return null;

  const entry = entryFor(receiver, method);
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

// --- LSP plumbing (JSON-RPC over stdio) ----------------------------------------

const encoder = new TextEncoder();

const send = async (message: unknown) => {
  const body = encoder.encode(JSON.stringify(message));
  await Deno.stdout.write(
    encoder.encode(`Content-Length: ${body.length}\r\n\r\n`),
  );
  await Deno.stdout.write(body);
};

const respond = (id: number | string, result: unknown) =>
  send({ jsonrpc: "2.0", id, result });

const notify = (method: string, params: unknown) =>
  send({ jsonrpc: "2.0", method, params });

const publishDiagnostics = (uri: string) =>
  notify("textDocument/publishDiagnostics", {
    uri,
    diagnostics: diagnostics(uri),
  });

// When the workspace isn't a DragonRuby project, the server stays dormant:
// it answers the lifecycle but advertises no capabilities and indexes
// nothing, so the extension can be enabled for Ruby globally without
// interfering with non-DragonRuby projects.
let dormant = false;

const hasProjectMarker = async (dir: string): Promise<boolean> => {
  for (const marker of ["dragonruby", "dragonruby.exe", "mygame"]) {
    try {
      await Deno.stat(join(dir, marker));
      return true;
    } catch {
      // keep looking
    }
  }
  return false;
};

/**
 * DragonRuby project directories within the workspace: the root itself, or
 * any direct child (monorepos keep the game one level down, e.g.
 * conjuration/demo). A drenv library repo (root drenv.toml) counts too — its
 * lib/ deserves indexing and engine intelligence without a game directory.
 */
const projectDirs = async (root: string): Promise<string[]> => {
  const dirs: string[] = [];
  if (await hasProjectMarker(root)) dirs.push(root);

  try {
    for await (const entry of Deno.readDir(root)) {
      if (!entry.isDirectory || entry.name.startsWith(".")) continue;
      const child = join(root, entry.name);
      if (await hasProjectMarker(child)) dirs.push(child);
    }
  } catch {
    // unreadable root
  }

  if (!dirs.includes(root)) {
    try {
      await Deno.stat(join(root, "drenv.toml"));
      dirs.push(root);
    } catch {
      // not a library repo either
    }
  }

  return dirs;
};

// deno-lint-ignore no-explicit-any
const handle = async (msg: any) => {
  const { id, method, params } = msg;

  if (dormant) {
    switch (method) {
      case "shutdown":
        await respond(id, null);
        return;
      case "exit":
        Deno.exit(0);
        break;
      default:
        if (id !== undefined) await respond(id, null);
        return;
    }
  }

  switch (method) {
    case "initialize": {
      const root = params.rootUri
        ? fromFileUrl(params.rootUri)
        : params.rootPath ?? Deno.cwd();

      const roots = await projectDirs(root);
      if (roots.length === 0) {
        dormant = true;
        await respond(id, {
          capabilities: {},
          serverInfo: { name: "drenv-lsp", version: "spike (dormant)" },
        });
        break;
      }

      await buildApiIndex();
      const indexedRoots = new Set([root, ...roots].map((p) => resolve(p)));
      for (const dir of roots) {
        await scanWorkspace(dir, indexedRoots);
      }
      await respond(id, {
        capabilities: {
          textDocumentSync: 1, // full
          completionProvider: { triggerCharacters: ["."] },
          signatureHelpProvider: { triggerCharacters: ["(", ","] },
          hoverProvider: true,
          definitionProvider: true,
          referencesProvider: true,
        },
        serverInfo: { name: "drenv-lsp", version: "spike" },
      });
      break;
    }

    case "textDocument/didOpen":
      indexFile(params.textDocument.uri, params.textDocument.text);
      await publishDiagnostics(params.textDocument.uri);
      break;

    case "textDocument/didChange":
      indexFile(params.textDocument.uri, params.contentChanges[0].text);
      await publishDiagnostics(params.textDocument.uri);
      break;

    case "textDocument/completion":
      await respond(id, completions(params.textDocument.uri, params.position));
      break;

    case "textDocument/signatureHelp":
      await respond(
        id,
        signatureHelp(params.textDocument.uri, params.position),
      );
      break;

    case "textDocument/hover":
      await respond(id, hover(params.textDocument.uri, params.position));
      break;

    case "textDocument/definition":
      await respond(id, definition(params.textDocument.uri, params.position));
      break;

    case "textDocument/references":
      await respond(id, references(params.textDocument.uri, params.position));
      break;

    case "shutdown":
      await respond(id, null);
      break;

    case "exit":
      Deno.exit(0);
      break;

    default:
      if (id !== undefined) await respond(id, null);
  }
};

export default async function lsp() {
  await initParser();

  const decoder = new TextDecoder();
  let buffer = new Uint8Array(0);

  for await (const chunk of Deno.stdin.readable) {
    const merged = new Uint8Array(buffer.length + chunk.length);
    merged.set(buffer);
    merged.set(chunk, buffer.length);
    buffer = merged;

    while (true) {
      const headerEnd = findHeaderEnd(buffer);
      if (headerEnd === -1) break;

      const header = decoder.decode(buffer.slice(0, headerEnd));
      const length = Number(header.match(/Content-Length: (\d+)/i)?.[1] ?? 0);
      const total = headerEnd + 4 + length;
      if (buffer.length < total) break;

      const body = decoder.decode(buffer.slice(headerEnd + 4, total));
      buffer = buffer.slice(total);
      await handle(JSON.parse(body));
    }
  }
}

const findHeaderEnd = (buf: Uint8Array): number => {
  for (let i = 0; i + 3 < buf.length; i++) {
    if (
      buf[i] === 13 && buf[i + 1] === 10 && buf[i + 2] === 13 &&
      buf[i + 3] === 10
    ) return i;
  }
  return -1;
};
