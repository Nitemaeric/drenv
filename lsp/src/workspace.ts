import { walk } from "@std/fs";
import { join, resolve, toFileUrl } from "@std/path";

import { readLock } from "../../utils/lockfile.ts";
import { nodeRange } from "./analyze.ts";
import { type Node, Ruby, type Tree } from "./ruby.ts";
import type { Def } from "./types.ts";

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

  removeFile(uri: string): void {
    this.generation++;
    this.#dropDefs(uri);
    this.#fileText.delete(uri);
    this.#fileTree.delete(uri);
  }

  async scan(roots: string[], indexedRoots: Set<string>): Promise<void> {
    for (const root of roots) {
      for (const sub of ["mygame/app", "app", "lib"]) {
        await this.#indexTree(join(root, sub));
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

  async #indexTree(dir: string): Promise<void> {
    try {
      for await (
        const entry of walk(dir, { exts: [".rb"], includeDirs: false })
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
