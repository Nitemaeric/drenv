// drenv lsp — SPIKE. A minimal DragonRuby language server over stdio.
// Proves: tree-sitter-ruby (wasm) in Deno, engine-derived API intelligence,
// and the core LSP surface (completion, hover, definition/references,
// syntax + method-validity diagnostics). Not production code.
import { Language, Node, Parser, Tree } from "npm:web-tree-sitter@0.25.3";
import { walk } from "@std/fs";
import { fromFileUrl, join, toFileUrl } from "@std/path";

import { versionsPath } from "../constants.ts";
import { installedVersions } from "../utils/installed-versions.ts";

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

type ApiEntry = { label: string; doc: string };

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
        entries.push({ label: method, doc: docLines.join("\n") });
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
};
type Pos = { line: number; character: number };

const defs = new Map<string, Location[]>(); // identifier -> definitions
const fileText = new Map<string, string>(); // uri -> latest text
const fileTree = new Map<string, Tree>();

const nodeRange = (node: Node) => ({
  start: { line: node.startPosition.row, character: node.startPosition.column },
  end: { line: node.endPosition.row, character: node.endPosition.column },
});

const indexFile = (uri: string, text: string) => {
  fileText.set(uri, text);
  const tree = parser.parse(text)!;
  fileTree.set(uri, tree);

  // Drop this file's old definitions, then re-add.
  for (const [name, locs] of defs) {
    const kept = locs.filter((loc) => loc.uri !== uri);
    if (kept.length > 0) defs.set(name, kept);
    else defs.delete(name);
  }

  const visit = (node: Node) => {
    if (["method", "class", "module"].includes(node.type)) {
      const name = node.childForFieldName("name");
      if (name) {
        const list = defs.get(name.text) ?? [];
        list.push({ uri, range: nodeRange(name) });
        defs.set(name.text, list);
      }
    }
    for (let i = 0; i < node.namedChildCount; i++) visit(node.namedChild(i)!);
  };
  visit(tree.rootNode);
  return tree;
};

const scanWorkspace = async (root: string) => {
  for (const sub of ["mygame/app", "mygame/vendor", "app", "vendor", "lib"]) {
    const dir = join(root, sub);
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

  // Fall back to workspace definitions + engine top-levels.
  const items: unknown[] = [...defs.keys()].map((name) => ({
    label: name,
    kind: 3, // Function
  }));
  for (const mod of ["Geometry", "Easing"]) {
    if (api.has(mod)) items.push({ label: mod, kind: 9 }); // Module
  }
  return items;
};

const wordAt = (uri: string, pos: Pos): string | null => {
  const text = fileText.get(uri) ?? "";
  const line = text.split("\n")[pos.line] ?? "";
  const before = line.slice(0, pos.character).match(/[\w?!]*$/)?.[0] ?? "";
  const after = line.slice(pos.character).match(/^[\w?!]*/)?.[0] ?? "";
  const word = before + after;
  return word || null;
};

const hover = (uri: string, pos: Pos): unknown => {
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

  // Workspace definition?
  const found = defs.get(word);
  if (found?.length) {
    return {
      contents: {
        kind: "markdown",
        value: `**${word}** — defined in ${
          found.map((f) => fromFileUrl(f.uri).split("/").slice(-2).join("/"))
            .join(", ")
        }`,
      },
    };
  }
  return null;
};

const definition = (uri: string, pos: Pos): Location[] => {
  const word = wordAt(uri, pos);
  return word ? defs.get(word) ?? [] : [];
};

const references = (uri: string, pos: Pos): Location[] => {
  const word = wordAt(uri, pos);
  if (!word) return [];

  const out: Location[] = [];
  const pattern = new RegExp(`\\b${word.replace(/[?!]/g, "\\$&")}\\b`, "g");
  for (const [fileUri, text] of fileText) {
    const lines = text.split("\n");
    for (let line = 0; line < lines.length; line++) {
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

// deno-lint-ignore no-explicit-any
const handle = async (msg: any) => {
  const { id, method, params } = msg;

  switch (method) {
    case "initialize": {
      const root = params.rootUri
        ? fromFileUrl(params.rootUri)
        : params.rootPath ?? Deno.cwd();
      await buildApiIndex();
      await scanWorkspace(root);
      await respond(id, {
        capabilities: {
          textDocumentSync: 1, // full
          completionProvider: { triggerCharacters: ["."] },
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
