import { walk } from "@std/fs";
import { dirname, join, resolve, toFileUrl } from "@std/path";

import { readLock } from "../../utils/lockfile.ts";
import { nodeRange } from "./analyze.ts";
import { type Node, Ruby, type Tree } from "./ruby.ts";
import type { Def, Pos } from "./types.ts";

/** A single `textDocument/didChange` edit. A ranged edit patches the stored
 * text; a change with no `range` is a full-document replacement. */
export type ContentChange = { range?: { start: Pos; end: Pos }; text: string };

/** UTF-16 offset of an LSP position within `text`. LSP characters are UTF-16
 * code units, which is exactly JS string indexing, so no re-encoding needed. */
const offsetAt = (text: string, pos: Pos): number => {
  let lineStart = 0;
  for (let line = 0; line < pos.line; line++) {
    const nl = text.indexOf("\n", lineStart);
    if (nl === -1) return text.length;
    lineStart = nl + 1;
  }
  const nextNl = text.indexOf("\n", lineStart);
  const lineEnd = nextNl === -1 ? text.length : nextNl;
  return Math.min(lineStart + pos.character, lineEnd);
};

export class Workspace {
  readonly defs = new Map<string, Def[]>();
  generation = 0;

  #ruby: Ruby;
  #fileText = new Map<string, string>();
  #fileTree = new Map<string, Tree>();

  constructor(ruby: Ruby) {
    this.#ruby = ruby;
  }

  fileText(uri: string): string | undefined {
    return this.#fileText.get(uri);
  }

  fileTree(uri: string): Tree | undefined {
    return this.#fileTree.get(uri);
  }

  fileUris(): Iterable<string> {
    return this.#fileText.keys();
  }

  indexFile(uri: string, text: string): Tree {
    this.generation++;
    this.#fileText.set(uri, text);
    const tree = this.#ruby.parse(text);
    this.#fileTree.set(uri, tree);
    const lines = text.split("\n");

    this.#dropDefs(uri);

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

    const addDef = (name: string, loc: Def) => {
      const list = this.defs.get(name) ?? [];
      list.push(loc);
      this.defs.set(name, list);
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
            kind: node.type as Def["kind"],
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

      // `def self.x` is a class-level method (display `Class.x`). A non-`self`
      // receiver (`def SomeConst.x`) isn't certain to be this namespace, so skip.
      if (
        node.type === "singleton_method" &&
        node.childForFieldName("object")?.type === "self"
      ) {
        const name = node.childForFieldName("name");
        if (name) {
          addDef(name.text, {
            uri,
            range: nodeRange(name),
            kind: "method",
            container: container || undefined,
            doc: docAbove(node.startPosition.row),
            singleton: true,
          });
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
  }

  /** Applies ranged `didChange` edits to the stored text, then re-indexes the
   * file. The def index has no incremental form, so the whole new tree is
   * re-visited (via indexFile) — cheap next to the parse. Falls back to
   * treating the uri as empty when it has no stored buffer yet. */
  applyEdits(uri: string, changes: ContentChange[]): Tree {
    let text = this.#fileText.get(uri) ?? "";
    for (const change of changes) {
      if (change.range === undefined) {
        text = change.text;
        continue;
      }
      const start = offsetAt(text, change.range.start);
      const end = offsetAt(text, change.range.end);
      text = text.slice(0, start) + change.text + text.slice(end);
    }
    return this.indexFile(uri, text);
  }

  removeFile(uri: string): void {
    this.generation++;
    this.#dropDefs(uri);
    this.#fileText.delete(uri);
    this.#fileTree.delete(uri);
  }

  async scan(roots: string[], indexedRoots: Set<string>): Promise<void> {
    // Vendored packages are indexed separately (below) with twin-skips, so the
    // whole-tree walks must exclude them.
    const skipVendor = [/[/\\]vendor[/\\]/];
    for (const root of roots) {
      // All Ruby under `mygame/` — app/, lib/, and whatever layout the project
      // chose — not just mygame/app. `app`/`lib` at the root cover library
      // repos and the case where mygame/ itself is opened as the workspace.
      for (const sub of ["mygame", "app", "lib"]) {
        await this.#indexTree(join(root, sub), skipVendor);
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
            await this.#indexTree(join(vendor, entry.name));
          }
        }
      }
    }
  }

  #dropDefs(uri: string): void {
    for (const [name, locs] of this.defs) {
      const kept = locs.filter((loc) => loc.uri !== uri);
      if (kept.length > 0) this.defs.set(name, kept);
      else this.defs.delete(name);
    }
  }

  async #indexTree(dir: string, skip: RegExp[] = []): Promise<void> {
    try {
      for await (
        const entry of walk(dir, { exts: [".rb"], includeDirs: false, skip })
      ) {
        this.indexFile(
          toFileUrl(entry.path).href,
          await Deno.readTextFile(entry.path),
        );
      }
    } catch {
      // Directory doesn't exist in this project shape — fine.
    }
  }
}

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
export const detectProjectDirs = async (root: string): Promise<string[]> => {
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

/**
 * A DragonRuby engine that ships inside the workspace — the standard layout
 * where the engine zip is unpacked and the game lives in `mygame/` beside
 * `docs/oss/dragon/` and `docs/api/`. Returns the engine directory (the one
 * containing `docs/`) or null. Checked before drenv-managed versions so a
 * project opened in its own engine folder gets version-matched intelligence
 * even when drenv manages no copy of that version.
 */
export const detectWorkspaceEngine = async (
  root: string,
  projectDirs: string[],
): Promise<string | null> => {
  const candidates = new Set<string>();
  // The engine dir is the workspace root (game in mygame/), or one level up
  // when the game directory itself was opened (root is .../<engine>/mygame).
  for (const d of [root, ...projectDirs]) {
    candidates.add(d);
    candidates.add(dirname(d));
  }
  for (const dir of candidates) {
    try {
      const s = await Deno.stat(join(dir, "docs", "oss", "dragon"));
      if (s.isDirectory) return dir;
    } catch {
      // no engine here
    }
  }
  return null;
};

/**
 * Vendored packages whose `path:` source resolves to another indexed project
 * root are twins of workspace source (the vendored copy is a build artifact —
 * drenv re-syncs it from the source). Skip them so definitions point at the
 * one true copy, the one that's safe to edit.
 */
export const vendorSkips = async (
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
