import { basename, join } from "@std/path";

import { versionsPath } from "../../constants.ts";
import { installedVersions } from "../../utils/installed-versions.ts";

import type { Node, Ruby } from "./ruby.ts";
import type { ApiEntry } from "./types.ts";
import { extractParams, renderSignature } from "./analyze.ts";

// Receiver chain -> completions. `Geometry`/`Easing` are parsed out of the
// installed engine's own Ruby source; the `args` chains are curated for the
// spike (a full generator is post-spike work).
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

// mruby core index (spike: curated; production generates from mruby src).
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

const isDir = async (path: string): Promise<boolean> => {
  try {
    return (await Deno.stat(path)).isDirectory;
  } catch {
    return false;
  }
};

/**
 * The engine-derived API index: modules parsed from the installed DragonRuby's
 * own Ruby source, its markdown docs, and the curated core/args tables. With no
 * engine installed it degrades to an empty index (label `"unknown"`, empty
 * `api`/`methodDocs`, no args chains) while the version-independent
 * `coreMethods`/`literalClass` tables keep working.
 */
export class EngineIndex {
  readonly api = new Map<string, ApiEntry[]>();
  readonly validityReceivers = new Set(["Geometry", "Easing"]);
  readonly #methodDocs = new Map<string, Map<string, string>>();
  readonly #ruby: Ruby;
  #label = "unknown";

  private constructor(ruby: Ruby) {
    this.#ruby = ruby;
  }

  /** e.g. "7.11", or "unknown" with no engine. */
  get label(): string {
    return this.#label;
  }

  /** Discovers the installed engine (newest version under `versionsPath`).
   * `rootDir`, when given, is used directly as the engine directory and
   * discovery is skipped; a `rootDir` that doesn't exist degrades to the same
   * empty index as no engine. Never returns null. */
  static async build(ruby: Ruby, rootDir?: string): Promise<EngineIndex> {
    const index = new EngineIndex(ruby);

    let dir: string;
    if (rootDir !== undefined) {
      if (!(await isDir(rootDir))) return index;
      index.#label = basename(rootDir);
      dir = rootDir;
    } else {
      const version = (await installedVersions())[0];
      if (!version) return index;
      index.#label = version;
      dir = join(versionsPath, version);
    }

    await index.#index(dir);
    return index;
  }

  methodDocs(cls: string): Map<string, string> | undefined {
    return this.#methodDocs.get(cls);
  }

  coreMethods(cls: string): string[] | undefined {
    return CORE_METHODS[cls];
  }

  /** A literal receiver names its class outright — no inference needed. */
  literalClass(prefix: string): string | null {
    const lit = prefix.match(/(\]|\}|"|'|\d)\s*\.\s*\w*$/)?.[1];
    if (!lit) return null;
    if (lit === "]") return "Array";
    if (lit === "}") return "Hash";
    if (lit === '"' || lit === "'") return "String";
    return "Numeric";
  }

  async #index(dir: string): Promise<void> {
    await this.#indexEngineModule(dir, "geometry.rb", "Geometry");
    await this.#indexEngineModule(dir, "easing.rb", "Easing");

    for (const [chain, members] of Object.entries(ARGS_CHAINS)) {
      this.api.set(
        chain,
        members.map((label) => ({
          label,
          doc: `DragonRuby \`${chain}.${label}\``,
        })),
      );
    }

    await this.#indexDocsFile(dir, "geometry.md", "Geometry");
    await this.#indexDocsFile(dir, "easing.md", "Easing");
    await this.#indexDocsFile(dir, "array.md", "Array");
    await this.#indexDocsFile(dir, "numeric.md", "Numeric");
    await this.#indexDocsFile(dir, "outputs.md", "args.outputs");
    await this.#indexDocsFile(dir, "inputs.md", "args.inputs");

    await this.#indexArrayClassMethods(dir);

    // Enrich indexed entries with the markdown docs and surface doc-only
    // methods (e.g. C-implemented ones the Ruby source never mentions).
    for (const [key, docs] of this.#methodDocs) {
      const entries = this.api.get(key);
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
  }

  async #indexEngineModule(
    dir: string,
    file: string,
    name: string,
  ): Promise<void> {
    let text: string;
    try {
      text = await Deno.readTextFile(join(dir, "docs", "oss", "dragon", file));
    } catch {
      return;
    }

    const tree = this.#ruby.parse(text);
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

    if (entries.length > 0) this.api.set(name, entries);
  }

  async #indexDocsFile(
    dir: string,
    file: string,
    key: string,
  ): Promise<void> {
    let text: string;
    try {
      text = await Deno.readTextFile(join(dir, "docs", "api", file));
    } catch {
      return;
    }

    const docs = this.#methodDocs.get(key) ?? new Map<string, string>();
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

    this.#methodDocs.set(key, docs);
  }

  // DragonRuby exposes class-level variants of Array iteration methods
  // (documented as a bullet list, e.g. `Array.filter_map(collection)`).
  async #indexArrayClassMethods(dir: string): Promise<void> {
    let text: string;
    try {
      text = await Deno.readTextFile(join(dir, "docs", "api", "array.md"));
    } catch {
      return;
    }

    const section = text.split(/^## `Array` Class Methods$/m)[1];
    if (!section) return;

    const body = section.split(/^#{1,3} /m)[0];
    const instanceDocs = this.#methodDocs.get("Array");
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

    if (entries.length > 0) this.api.set("Array", entries);
  }
}
