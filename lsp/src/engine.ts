import { basename, join } from "@std/path";

import { homePath, versionsPath } from "../../constants.ts";
import { installedVersions } from "../../utils/installed-versions.ts";
import config from "../../deno.json" with { type: "json" };

import type { Ruby } from "./ruby.ts";
import type { ApiEntry } from "./types.ts";
import { buildArgsChains } from "./engine/args_tree.ts";
import { buildModule } from "./engine/modules.ts";
import { CORE_BASELINE } from "./engine/core.ts";
import {
  classMethodBullets,
  docOnlySignature,
  firstProse,
  memberNames,
  parseHeadings,
} from "./engine/md.ts";

// Compiled-in drenv version — same source of truth main.ts reports.
const DRENV_VERSION = config.version;
const DEFAULT_CACHE_DIR = join(homePath, "cache", "lsp");

// Bump on ANY change to derivation logic or curated-baseline content, not only
// to the api/methodDocs payload shape: #loadCache keys only on drenv/engine
// version, so a dev machine (unchanged drenvVersion) would otherwise serve stale
// derived data after an args-tree or CORE_BASELINE edit. Shape 1 was the spike.
const CACHE_SCHEMA_VERSION = 2;

// The built index serialized as plain data (no tree-sitter objects). Keyed by
// {schemaVersion, drenvVersion, engineVersion} so a schema bump, a drenv
// upgrade, or an engine swap invalidates.
type CacheFile = {
  schemaVersion: number;
  drenvVersion: string;
  engineVersion: string;
  api: [string, ApiEntry[]][];
  methodDocs: [string, [string, string][]][];
};

// Runtime modules parsed from the engine's own Ruby source.
const MODULE_FILES: [string, string][] = [
  ["geometry.rb", "Geometry"],
  ["easing.rb", "Easing"],
];

// Markdown files whose method headings enrich `methodDocs` (and, for entries
// already in `api`, their docs). Core-class extensions ride here.
const DOC_FILES: [string, string][] = [
  ["geometry.md", "Geometry"],
  ["easing.md", "Easing"],
  ["array.md", "Array"],
  ["numeric.md", "Numeric"],
];

const cacheFilePath = (cacheDir: string, label: string): string =>
  join(cacheDir, `${label}.json`);

const isDir = async (path: string): Promise<boolean> => {
  try {
    return (await Deno.stat(path)).isDirectory;
  } catch {
    return false;
  }
};

// A DragonRuby unpack labels its version only in CHANGELOG-CURR.txt, whose
// first org-mode heading is the version (`* 7.13`). Used to label an
// in-workspace engine, whose folder name is arbitrary.
const readEngineVersion = async (dir: string): Promise<string | null> => {
  try {
    const text = await Deno.readTextFile(join(dir, "CHANGELOG-CURR.txt"));
    return text.match(/^\*+\s*([0-9]+\.[0-9]+(?:\.[0-9]+)?)/m)?.[1] ?? null;
  } catch {
    return null;
  }
};

/**
 * The engine-derived API index: modules parsed from the installed DragonRuby's
 * own Ruby source, its markdown docs, the derived `args.*` chain tree, and the
 * curated plain-mruby core baseline (the one documented exception — see
 * engine/core.ts). With no engine installed it degrades to an empty index
 * (label `"unknown"`, empty `api`/`methodDocs`, no args chains) while the
 * version-independent `coreMethods`/`literalClass` tables keep working.
 */
export class EngineIndex {
  readonly api = new Map<string, ApiEntry[]>();
  readonly validityReceivers = new Set(["Geometry", "Easing"]);
  readonly #methodDocs = new Map<string, Map<string, string>>();
  // name -> heading body, per doc key; build-time only (doc-only signatures).
  readonly #docBodies = new Map<string, Map<string, string[]>>();
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
   * empty index as no engine. Never returns null.
   *
   * The built data is cached as JSON under `~/.drenv/cache/lsp/`. The cache is
   * consulted for a normal (production) build and when an explicit `cacheDir`
   * override is given, but is skipped when only `rootDir` overrides — so the
   * unit tests keep exercising the parse path. Options may be passed positional
   * (`rootDir` string, legacy) or as `{ rootDir?, cacheDir? }`. */
  static async build(
    ruby: Ruby,
    options?: string | { rootDir?: string; cacheDir?: string },
  ): Promise<EngineIndex> {
    const rootDir = typeof options === "string" ? options : options?.rootDir;
    const cacheDir = typeof options === "string"
      ? undefined
      : options?.cacheDir;

    const index = new EngineIndex(ruby);

    let dir: string;
    if (rootDir !== undefined) {
      if (!(await isDir(rootDir))) return index;
      index.#label = (await readEngineVersion(rootDir)) ?? basename(rootDir);
      dir = rootDir;
    } else {
      const version = (await installedVersions())[0];
      if (!version) return index;
      index.#label = version;
      dir = join(versionsPath, version);
    }

    const effectiveCacheDir = cacheDir ??
      (rootDir === undefined ? DEFAULT_CACHE_DIR : undefined);

    if (
      effectiveCacheDir !== undefined &&
      await index.#loadCache(effectiveCacheDir)
    ) {
      return index;
    }

    await index.#index(dir);

    if (effectiveCacheDir !== undefined) {
      await index.#writeCache(effectiveCacheDir);
    }

    return index;
  }

  /** Populate from the cache file for this label. Returns false (leaving the
   * index untouched) on a missing file, a schema/version mismatch, or any
   * parse/shape error — the caller then reparses and rewrites. */
  async #loadCache(cacheDir: string): Promise<boolean> {
    let text: string;
    try {
      text = await Deno.readTextFile(cacheFilePath(cacheDir, this.#label));
    } catch {
      return false;
    }

    try {
      const data = JSON.parse(text) as CacheFile;
      if (
        data.schemaVersion !== CACHE_SCHEMA_VERSION ||
        data.drenvVersion !== DRENV_VERSION ||
        data.engineVersion !== this.#label
      ) {
        return false;
      }

      for (const [key, entries] of data.api) {
        if (typeof key !== "string" || !Array.isArray(entries)) throw 0;
        for (const e of entries) {
          if (typeof e.label !== "string" || typeof e.doc !== "string") throw 0;
        }
        this.api.set(key, entries);
      }
      for (const [key, pairs] of data.methodDocs) {
        if (typeof key !== "string" || !Array.isArray(pairs)) throw 0;
        this.#methodDocs.set(key, new Map(pairs));
      }
      return true;
    } catch {
      this.api.clear();
      this.#methodDocs.clear();
      return false;
    }
  }

  /** Serialize the built index. Write failures are non-fatal (stderr note). */
  async #writeCache(cacheDir: string): Promise<void> {
    try {
      await Deno.mkdir(cacheDir, { recursive: true });
      const payload: CacheFile = {
        schemaVersion: CACHE_SCHEMA_VERSION,
        drenvVersion: DRENV_VERSION,
        engineVersion: this.#label,
        api: [...this.api.entries()],
        methodDocs: [...this.#methodDocs.entries()].map(
          ([k, m]) => [k, [...m.entries()]] as [string, [string, string][]],
        ),
      };
      await Deno.writeTextFile(
        cacheFilePath(cacheDir, this.#label),
        JSON.stringify(payload),
      );
    } catch (err) {
      console.error(`drenv lsp: engine cache write failed: ${err}`);
    }
  }

  methodDocs(cls: string): Map<string, string> | undefined {
    return this.#methodDocs.get(cls);
  }

  /** Plain-mruby baseline (engine/core.ts) unioned with the engine-derived
   * DragonRuby extensions for that core class (its md method headings). With no
   * engine the union collapses to the baseline. */
  coreMethods(cls: string): string[] | undefined {
    const baseline = CORE_BASELINE[cls];
    if (!baseline) return undefined;
    const docs = this.#methodDocs.get(cls);
    if (!docs || docs.size === 0) return baseline;
    return [...new Set([...baseline, ...docs.keys()])];
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
    for (const [file, name] of MODULE_FILES) {
      const entries = await buildModule(this.#ruby, dir, file);
      if (entries.length > 0) this.api.set(name, entries);
    }

    for (const [chain, members] of await buildArgsChains(dir)) {
      this.api.set(chain, members);
    }

    // `args.geometry` delegates to the Geometry module — reuse its entries so
    // the chain carries the same parsed signatures rather than bare doc names.
    const geometry = this.api.get("Geometry");
    if (geometry) this.api.set("args.geometry", geometry);

    for (const [file, key] of DOC_FILES) {
      await this.#loadDocs(dir, file, key);
    }

    for (const cls of Object.keys(CORE_BASELINE)) {
      await this.#loadClassMethods(dir, `${cls.toLowerCase()}.md`, cls);
    }

    this.#enrich();
  }

  async #loadDocs(dir: string, file: string, key: string): Promise<void> {
    let text: string;
    try {
      text = await Deno.readTextFile(join(dir, "docs", "api", file));
    } catch {
      return;
    }

    const docs = this.#methodDocs.get(key) ?? new Map<string, string>();
    const bodies = this.#docBodies.get(key) ?? new Map<string, string[]>();
    for (const h of parseHeadings(text)) {
      if (h.level < 2) continue;
      const names = memberNames(h.text);
      if (names.length === 0) continue;
      const doc = firstProse(h.body);
      for (const name of names) {
        if (!bodies.has(name)) bodies.set(name, h.body);
        if (doc && !docs.has(name)) docs.set(name, doc);
      }
    }
    this.#methodDocs.set(key, docs);
    this.#docBodies.set(key, bodies);
  }

  // Class-level (constant-receiver) variants live in a `` `Class` Class Methods ``
  // bullet list, distinct from the instance method headings. This drives
  // `Array.filter_map` completion.
  async #loadClassMethods(
    dir: string,
    file: string,
    cls: string,
  ): Promise<void> {
    let text: string;
    try {
      text = await Deno.readTextFile(join(dir, "docs", "api", file));
    } catch {
      return;
    }

    const names = classMethodBullets(text, cls);
    if (names.length === 0) return;

    const instanceDocs = this.#methodDocs.get(cls);
    const entries: ApiEntry[] = names.map((name) => {
      const variant =
        `Class-level variant: \`${cls}.${name}(collection, ...)\` — ` +
        `like \`#${name}\`, but a bit faster. Assumes the collection isn't ` +
        `mutated during iteration.`;
      const instance = instanceDocs?.get(name);
      return {
        label: name,
        doc: instance ? `${variant}\n\n---\n\n${instance}` : variant,
      };
    });
    this.api.set(cls, entries);
  }

  // Enrich indexed entries with the markdown docs and surface doc-only methods
  // (C-implemented ones the Ruby source never mentions), synthesizing a
  // signature only when the doc's code fences make it unambiguous.
  #enrich(): void {
    for (const [key, docs] of this.#methodDocs) {
      const entries = this.api.get(key);
      if (!entries) continue;
      for (const entry of entries) {
        const doc = docs.get(entry.label);
        if (doc) entry.doc = doc;
      }
      const bodies = this.#docBodies.get(key);
      for (const [name, doc] of docs) {
        if (entries.some((e) => e.label === name)) continue;
        const body = bodies?.get(name);
        const sig = body ? docOnlySignature(this.#ruby, body, name) : null;
        entries.push({ label: name, doc, ...(sig ?? {}) });
      }
    }
  }
}
