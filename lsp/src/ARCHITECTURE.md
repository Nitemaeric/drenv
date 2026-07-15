# drenv lsp — production architecture contract

This is the binding contract for modularizing the spike (`lsp/server.ts`, ~1,800
lines, the **behavior reference**) into production modules. Implementers extract
logic from the spike — behavior must not drift. The end-to-end lock is
`lsp/client-test.ts` (49 checks):
`deno run -A lsp/client-test.ts deno run -A
main.ts lsp` must print
`ALL CHECKS PASSED` when integration completes.

## Ground rules

- Deno 2.x. Imports: `@std/*` via the root import map; tree-sitter as
  `npm:web-tree-sitter@0.25.3` (same as the spike).
- Tests are colocated `<module>.test.ts` (repo convention — see
  `utils/*.test.ts`), run by CI's `deno test -A --unstable-kv` on 5 platforms:
  **no test may depend on a real DragonRuby install, the network, or this
  machine's paths**. Synthesize fixtures in temp dirs; use forward slashes via
  `@std/path` joins.
- stdout of the LSP process is protocol-pure. All logging goes to stderr
  (`console.error`).
- Comments: sparse. Only non-obvious constraints; never narration. Density in
  the spike is the ceiling, not the floor.
- Module-level mutable state is banned. State lives in the classes below and is
  wired together in `server.ts`.

## Layout and dependency edges

```
lsp/
  server.ts            entry (rewritten LAST, in integration)
  client-test.ts       behavior lock (do not modify)
  vendor/*.wasm        embedded grammars (do not modify)
  src/
    types.ts           shared types (no imports from src/)
    ruby.ts            tree-sitter lifecycle          → types
    protocol.ts        JSON-RPC framing               → types
    analyze.ts         pure tree analysis             → ruby, types
    workspace.ts       workspace index                → ruby, analyze, types
    resolve.ts         name/local/context resolution  → workspace, ruby, types
    yard.ts            doc rendering                  → types (ConstResolver)
    engine.ts          engine-index facade (EngineIndex) → engine/*, ruby, analyze, types
    engine/            (P2 split — see Fleet contracts)
      args_tree.ts     args.* chain tree from docs/api/*.md
      modules.ts       Geometry/Easing from docs/oss/dragon/*.rb + md enrichment
      core.ts          CORE_BASELINE (mruby exception) + DR core-class extensions
      md.ts            md heading/fence parsing, doc-only signature extraction
    perf.ts            pure perf-rule fns + tick call-graph (P3)  → analyze, resolve, types
    handlers/
      ctx.ts           shared handler context         → workspace, resolve, yard, engine, types
      completion.ts    → workspace, resolve, yard, engine
      hover.ts         → workspace, resolve, yard, engine
      navigation.ts    → workspace, resolve, analyze
      signature.ts     → workspace, engine
      diagnostics.ts   → workspace, engine, analyze, resolve, perf
      manifest.ts      drenv.toml diagnostics + completion (P3) → utils/manifest (repo)
```

No cycles. `yard.ts` depends only on the `ConstResolver` interface from
`types.ts`, never on `resolve.ts`.

## Module contracts

### types.ts

```ts
export type Pos = { line: number; character: number };
export type Range = { start: Pos; end: Pos };
export type Loc = { uri: string; range: Range };
/** A workspace definition. */
export type Def = Loc & {
  container?: string; // enclosing namespace, "Conjuration::Animation"
  kind?: "method" | "class" | "module";
  doc?: string; // raw comment block, rendered lazily
  superclass?: string; // as written at the class site
  singleton?: boolean; // P3: `def self.x` — display `Class.x`, not `Class#x`
  includes?: string[]; // `include X` module names in this body, as written
  extends?: string[]; // `extend X` module names in this body, as written
};
export type Param = {
  label: string;
  name: string;
  kind: "required" | "optional" | "rest" | "keyword" | "keyword_optional";
  shape?: string[];
};
export type ApiEntry = {
  label: string;
  doc: string;
  params?: Param[];
  signature?: string;
};
export interface ConstResolver {
  resolveConst(path: string, container: string): Def | null;
  resolveConstName(path: string, container: string): string | null;
}
```

### ruby.ts

```ts
export class Ruby {
  /** Loads both wasm blobs from ../vendor as BYTES (deno compile --include
   * compatibility — never Language.load(path)). */
  static async init(): Promise<Ruby>;
  parse(text: string): Tree;
}
export type { Node, Tree } from "npm:web-tree-sitter@0.25.3";
```

### protocol.ts

```ts
export type RpcMessage = {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
};
/** Content-Length framed reader; must handle messages split across chunks
 * and multiple messages per chunk (multi-byte-safe). */
export async function* readMessages(
  input: ReadableStream<Uint8Array>,
): AsyncGenerator<RpcMessage>;
export class Connection {
  constructor(out: { write(p: Uint8Array): Promise<number> });
  respond(id: number | string, result: unknown): Promise<void>;
  notify(method: string, params: unknown): Promise<void>;
}
```

### analyze.ts

Pure functions over tree nodes, extracted verbatim from the spike:
`extractParams(method: Node): Param[]`, `deriveShapes` (internal),
`renderSignature(name: string, params: Param[]): string`,
`nodeRange(node:
Node): Range` (the shared Node→Range helper used by workspace,
diagnostics, navigation, and resolve), and the `GEOM_ATTRS` whitelist.

### workspace.ts

```ts
export class Workspace {
  constructor(ruby: Ruby);
  readonly defs: Map<string, Def[]>;
  /** Monotonic, starts at 0; every `defs` mutation (indexFile, removeFile)
   * bumps it. Consumers cache against it and must seed their cached value with
   * a sentinel that can never equal a live generation (the spike uses -1) so
   * the first query always rebuilds. */
  generation: number;
  fileText(uri: string): string | undefined;
  fileTree(uri: string): Tree | undefined;
  fileUris(): Iterable<string>;
  /** The spike's indexFile visitor: containers, method/class/module defs,
   * attr_reader/writer/accessor symbol defs, superclass capture, `include`/
   * `extend` module-name capture on the enclosing namespace, line-walk docAbove
   * (comments are NOT reliable tree siblings). */
  indexFile(uri: string, text: string): Tree;
  /** Drops `fileText`/`fileTree` for `uri` and bumps `generation`. New
   * behavior (no spike caller): used by didClose only for buffers with no
   * on-disk copy — see server.ts. */
  removeFile(uri: string): void;
  /** Indexes all `.rb` under each root's `mygame/` (app/, lib/, or any layout)
   * plus a top-level `app`/`lib`, excluding `vendor/`; then the vendored
   * packages under `<root>/mygame/vendor` and `<root>/vendor`, skipping twins
   * computed per vendor base (missing dirs are swallowed). `fileText`/
   * `fileTree` cover every scanned on-disk file, not just open buffers.
   * `indexedRoots` is the `resolve()`-normalized set of all indexed roots — it
   * must include the workspace root passed to the server plus every detected
   * project dir (spike: `new Set([root, ...projectDirs].map(resolve))`). */
  scan(roots: string[], indexedRoots: Set<string>): Promise<void>;
}
/** Spike's dormant/monorepo detection: markers (dragonruby, dragonruby.exe,
 * mygame) at root and one level down; root drenv.toml counts as a library. */
export function detectProjectDirs(root: string): Promise<string[]>;
/** Spike's vendorSkips, computed per vendor base: vendored packages whose lock
 * (`<base>/drenv.lock`, via utils/lockfile readLock) has a `path:` source that
 * `resolve()`s into `indexedRoots`. Skips are per-base — `mygame/vendor` and
 * `<root>/vendor` may carry different locks, so a single union set can
 * over-skip. May instead be an internal helper of `scan`. */
export function vendorSkips(
  base: string,
  indexedRoots: Set<string>,
): Promise<Set<string>>;
```

(Match the spike's actual signatures for detection/skips if they differ in
detail — behavior wins over this sketch.)

### resolve.ts

```ts
export type LocalHit = {
  role: "parameter" | "block parameter" | "local variable";
  node: Node;
  method: Node;
  methodLabel: string;
};
export class Resolver implements ConstResolver {
  constructor(ws: Workspace);
  wordAt(uri: string, pos: Pos): string | null;
  enclosingNamespace(node: Node): string;
  resolveLocal(uri: string, pos: Pos, word: string): LocalHit | null;
  /** Qualified class/module -> Def; cached against ws.generation. Skips method
   * and kind-less defs, and keeps the first Def per qualified name (first-wins;
   * later same-named defs do not overwrite). */
  namespaceIndex(): Map<string, Def>;
  resolveConstName(path: string, container: string): string | null;
  resolveConst(path: string, container: string): Def | null;
  /** A class's instance-method ancestry, nearest first: itself, the modules it
   * `include`s (recursively), and its superclass chain (each expanded likewise);
   * cycle-guarded. `extend` adds singleton methods, so it's excluded here (see
   * methodsOf's singleton branch). */
  ancestors(qualified: string): string[];
  /** Instance (default) or singleton methods reachable on a class. Instance:
   * walks `ancestors`. Singleton: each class in the superclass chain contributes
   * its own `def self.x` methods plus the instance methods of modules it
   * `extend`s. */
  methodsOf(qualified: string, opts?: { singleton?: boolean }): Def[];
  /** Bare-call candidate ranking: enclosing class + its ancestry (superclass
   * chain and includes), then same-file; null when no tier hits. */
  contextCandidates(uri: string, pos: Pos, found: Def[]): Def[] | null;
}
```

### yard.ts

```ts
export class YardRenderer {
  constructor(resolver: ConstResolver);
  /** Raw comment block (plain or YARD) -> markdown. Cache keyed by
   * container + raw. */
  render(raw: string, container?: string): string;
  /** Render a single YARD type list, linking workspace constants. (spike
   * renderType) — exposed because hover hand-builds inline `@param` docs from
   * it rather than the bulleted section `render` emits. */
  renderType(type: string, container: string): string;
  /** RDoc `+code+` → markdown backticks. (spike inlineMd) — same hover use. */
  inlineMd(s: string): string;
  clear(): void;
}
```

Behavior extracted verbatim: `@param`/`@return`/`@yield`/`@yieldparam`/
`@yieldreturn`/`@raise`/`@note`/`@deprecated`/`@see`/`@example`, unknown-tag
italics, indented continuations (blockquote-aware), RDoc `+code+` → backticks,
namespace-relative constant links (`renderType`, `seeLink`).

To match the spike, `server.ts` does NOT call `clear()` on reindex — the render
cache persists for the process lifetime (cached constant links may go stale
after the namespace index moves; the spike accepts this). `clear()` exists only
for tests that recreate state.

### engine.ts

```ts
export class EngineIndex {
  /** Discovers the installed engine like the spike (utils/installed-versions,
   * constants versionsPath). Never returns null: with no engine installed it
   * returns an empty index (label "unknown", empty `api`/`methodDocs`, no args
   * chains — exactly the spike's early-return state) so the server still serves
   * workspace intelligence. The version-independent `coreMethods`/`literalClass`
   * tables are populated even in the empty index, so literal-receiver core
   * completion keeps working with no engine. `rootDir`, when given, is used
   * directly as the engine directory (the dir the spike forms as
   * `join(versionsPath, version)`, holding the parsed `.rb`/docs sources);
   * discovery is skipped and `label` is `basename(rootDir)`. */
  static build(ruby: Ruby, rootDir?: string): Promise<EngineIndex>;
  readonly label: string; // e.g. "7.11", or "unknown" with no engine
  readonly api: Map<string, ApiEntry[]>; // "Geometry", "Easing", args chains
  readonly validityReceivers: Set<string>;
  methodDocs(cls: string): Map<string, string> | undefined;
  coreMethods(cls: string): string[] | undefined;
  literalClass(prefix: string): string | null;
}
```

The public accessor surface above is **frozen** — handlers depend on it. P2
changes only how the maps are _populated_ (see Fleet contracts §1): the curated
`ARGS_CHAINS` is replaced by a docs-derived args tree, `CORE_METHODS` is renamed
`CORE_BASELINE` and demoted to the documented mruby exception with
engine-derived extensions layered on top. The implementation splits into
`src/engine/*` behind this facade. The cache grows a `CACHE_SCHEMA_VERSION`
constant (§1). Tests synthesize a fake engine dir (temp): a minimal
`docs/oss/dragon/geometry.rb`, `docs/api/{array,outputs,inputs}.md`, guide file
— then assert parsing, args-tree derivation, shape derivation, doc attachment,
and cache-schema invalidation.

### handlers/*

Stateless functions over a shared context:

```ts
// handlers/ctx.ts — it imports the four concrete classes, so it must NOT live
// in types.ts (which imports nothing from src/; that edge would cycle
// types → workspace → types, even as `import type`).
export type Ctx = {
  ws: Workspace;
  resolver: Resolver;
  yard: YardRenderer;
  engine: EngineIndex;
};
```

`ctx.engine` is always present but may be the empty index (no engine installed):
its `api`/`methodDocs` are empty and it exposes no args chains. Every
engine-derived branch must treat empty maps as "no engine data" and degrade
exactly as the spike does — literal-receiver core completion
(`coreMethods`/`literalClass`), syntax-error diagnostics, and array-manipulation
perf hints are all version-independent and keep firing with an empty engine.

- `completion.ts`: `completion(ctx, uri, pos): unknown[]` — engine chains,
  literal-receiver methods (union of `coreMethods(cls)` and `methodDocs(cls)`
  keys, with an `mruby` label fallback), workspace fallback with unambiguous
  docs.
- `hover.ts`: `hover(ctx, uri, pos): unknown` — engine api; instance/class
  variables (attr-doc borrowing); locals (`@param` doc extraction); def-site
  pinning; context candidates; reopened-namespace collapse; ambiguous list.
  Order matters — preserve the spike's branch order.
- `navigation.ts`: `definition(ctx, uri, pos)`, `references(ctx, uri, pos)` —
  local narrowing (method-scoped references), context narrowing, plain
  `{uri, range}` payloads (strip Def extras).
- `signature.ts`: `signatureHelp(ctx, uri, pos)` — tree-based active param.
- `diagnostics.ts`: `diagnostics(ctx, uri): unknown[]` — syntax errors,
  validity, arity, kwargs, duck shapes, perf hints. Validity/arity/kwargs/shape
  fire only when both `engine.validityReceivers.has(recv)` AND `engine.api` has
  a non-empty entry for `recv` (an unparsed receiver emits nothing). `MUTATORS`,
  the fixed `PERF_GUIDE` URL, and `mutationDuringIteration` are module
  constants/functions here — syntax errors and perf hints are engine-independent
  and fire with or without an engine, as in the spike. All gating rules
  (VALIDITY_RECEIVERS only, literal args only, Information severity for perf)
  preserved exactly, including message wording (client-test asserts on it).

### server.ts (integration, rewritten last)

Thin: parse args → `Ruby.init` → dispatch loop over
`readMessages(Deno.stdin.readable)`, awaiting each message before the next
(sequential — this is what guarantees `initialize`'s scan finishes before the
first `didOpen`, and serializes `indexFile`/`generation` bumps and diagnostic
publication). `EngineIndex.build`, workspace scan, and dormant detection run
inside the `initialize` handler (they need `rootUri`/`rootPath`); `Ruby.init` is
the only pre-loop setup. With no project markers the server goes dormant:
respond with empty `capabilities` and a `serverInfo.version` whose string
contains `"dormant"` (client-test asserts on it). didOpen/didChange reindex +
publish diagnostics. didClose (new behavior, not in the spike) re-reads the uri
from disk and re-indexes it if it still exists, calling `removeFile` only for
buffers with no on-disk twin — closing a still-on-disk file must not drop its
defs or `fileText` (references scans every `fileText` entry). **Every request/
notification is wrapped in try/catch: a handler failure logs to stderr and
answers `null` (never an LSP error object) — it must never kill the server.**
Unknown methods: respond `null` to requests, ignore notifications. Preserve the
spike's initialize response shape.

## Fleet contracts (P2 + P3)

These amend the module contracts above for the P2/P3 work. Same rules apply:
engine-derived over curated (one documented exception), complete generously and
warn conservatively, inference stops at one explicit hop. New diagnostics fire
only on provably-certain receivers/arguments.

### 1. Engine index generation (P2)

`engine.ts` becomes a thin facade (`EngineIndex`, unchanged public surface) over
`src/engine/*`. The build pipeline (`#index`) runs, in order: args tree →
runtime modules → md enrichment → core-class layering. Each stage is a pure
builder in its own file so it can be unit-tested against a synthesized engine
dir.

**Cache schema version (critical).** `CacheFile` gains `schemaVersion: number`,
guarded by a module constant `const CACHE_SCHEMA_VERSION = 2` (shape 1 is the
spike's current cache). `#loadCache` rejects (returns false → reparse+rewrite)
when `data.schemaVersion !== CACHE_SCHEMA_VERSION` **in addition to** the
existing `drenvVersion`/`engineVersion` checks — `drenvVersion` alone is
insufficient because iterative dev shares one version while the derived shape
changes. `#loadCache` keys only on `drenvVersion`/`engineVersion`, so the same
staleness hits derived **content** at unchanged shape: editing `CORE_BASELINE`
(adding a method) or fixing the args-tree parser changes output with no shape
change and no `drenvVersion` bump. Therefore bump `CACHE_SCHEMA_VERSION` on any
change to derivation **logic or curated-baseline content**, not only to the
`api`/`methodDocs` payload shape (new args-tree keys, added `params`/`signature`
fields, core-baseline layout) — else a dev machine serves stale derived data.
The args tree is stored in the existing `api` map under `args.*` keys, and
enriched `params`/`signature` already ride `ApiEntry`, so no new top-level cache
field beyond `schemaVersion` is required.

**Args chain tree (`engine/args_tree.ts`) — from `docs/api/*.md`.** The
authoritative source is the parenthetical chain annotation on markdown headings:
a heading of the form `# Title (`args.CHAIN`)` (any level `#`..`######`) opens a
section keyed `args.CHAIN`. Nested chains are their own keys — `inputs.md`
carries `# Inputs (`args.inputs`)`, `## Mouse (`args.inputs.mouse`)`, and
`## Keyboard (`args.inputs.keyboard`)`, each a separate `api` entry. In
`inputs.md` the parent `# Inputs (`args.inputs`)` is H1 while every nested chain
is H2, so a section must end at the next chain-annotated heading of **any**
level (not equal-or-higher) — otherwise the H1 parent never closes and would
swallow every H2 member of mouse/controller/keyboard. Members attach to the
nearest-preceding (innermost) chain annotation. Within a chain section, every
heading carrying one-or-more backticked lowercase-identifier tokens is a
**member** of that chain. Extract the **leading identifier** from each
backticked token, matching `^[a-z_][\w?!]*` and discarding any trailing
signature or arg text: `` `rect(offset: nil)` `` → `rect`,
`` `inside_rect? rect` `` → `inside_rect?`. Split multi-token headings on both
`,` and `OR` (real headings include `` `angle_to`, `angle` `` and
`` `click` OR `down`, `previous_click`, `up` ``), yielding each name.
Backtick-free category headings (`## Collection Render Orders`, `## Status`,
`### Properties`) are skipped. Two variadic annotation forms exist and expand
deterministically (the only two in the shipped docs):
`args.inputs.controller_(one-four)` → `controller_one|two|three|four`,
`args.inputs.key_(down|up|held)` → `args.inputs.key_down|key_up|key_held`. An
unrecognized parenthetical pattern keeps the literal token and logs to stderr.
The single-hop `args.` chain's members = the union of (a) every `args.X` chain
root discovered from md H1 annotations and (b) the `attr_accessor` symbols **and
`alias_method` targets** on `GTK::Args` in `docs/oss/dragon/args.rb` (this
recovers `runtime`, `recording` etc. from the accessors, and `gtk` — which is
`alias_method :gtk, :runtime`, absent from the `attr_accessor` block — from the
aliases; none have a dedicated md file). `args.state`, `args.cvars`, and
`args.pixel_arrays` appear as `args.` members but expose **no** static
sub-members — their contents are runtime/user-defined (P5). Chain members are
properties: no `signature`/`params`; `doc` is the first prose paragraph under
the member's heading (until the next heading or code fence), else a generic
`DragonRuby`args.CHAIN.member`` fallback.

**Runtime modules (`engine/modules.ts`).** The spike's `#indexEngineModule`
(parse `docs/oss/dragon/*.rb`, collect non-`_`-prefixed `method` defs with
`extractParams`/`renderSignature` and contiguous `#` comment docs) moves here
unchanged, driving `Geometry` and `Easing`. `validityReceivers` stays exactly
`{Geometry, Easing}` — the only receivers whose full surface is engine-owned.
Doc enrichment from `docs/api/*.md` (the spike's heading→body extraction and
doc-only surfacing) moves here too.

**Doc-only signatures (`engine/md.ts`).** For a method that has an md doc but no
runtime `.rb` def (C-implemented), synthesize `params`/`signature` **only when
unambiguous**: exactly one `def NAME ...` line inside a ```ruby fence in the
method's section, OR a single call form `Recv.NAME a, b` that is textually
identical (same arg count and names) across every fence in the section. If
fences disagree on arity, or mix positional and keyword forms ambiguously, or
show multiple variants → emit **no** signature (doc still rides
completion/hover; diagnostics stay silent — principle 2, since `signature`
drives arity/kwarg checks). Doc-only signatures **never** add to
`validityReceivers`: they enrich `api` entries for
completion/hover/signatureHelp on already-known receivers only.

**Core-class intelligence (`engine/core.ts`) — the documented mruby exception.**
`docs/oss/mruby/dragonruby-mruby-*.patch` are diffs against **upstream mruby
3.0.0** (per `dragonruby-mruby.readme.txt`: `git checkout 3.0.0` then apply).
All 9 patches together add only **5** `mrb_define_method` calls (`Kernel#rand`,
`Kernel#srand`, and `Random#initialize|rand|srand`); the full mruby core method
tables (`each`/`map`/`reduce`/…) live in unshipped upstream mruby. They
therefore **cannot** be engine-derived. `CORE_BASELINE` is a curated per-class
constant of plain-mruby-3.0.0 methods (the spike's `CORE_METHODS`, renamed) —
**the one deliberate, documented exception** to engine-derivation, and it must
carry a comment saying so and citing the patch-diff reality. On top of the
baseline, engine-derived DR core-class extensions are layered per class from
`docs/api/<class>.md` headings (array.md, numeric.md, …), cross-checked against
`docs/oss/dragon/<class>_docs.rb` (`docs_method_sort_order` + `def docs_<name>`
names). Instance extensions come from method **headings** (e.g.
`##`map_2d`),
but class-level (constant-receiver) methods live in a **bullet list** under a`
`Array` Class Methods ``heading (`- `filter_map``, `-`each``) — this bullet-list
channel must be retained and drives constant-receiver completion (`Array.` lists
`filter_map`, which the behavior lock asserts). A heading-only rewrite would
drop it. `coreMethods(cls)` returns `baseline ∪ extension labels`;
`methodDocs(cls)` returns the subset with md docs. Core classes get richer
completion/hover but are **never** added to `validityReceivers` (they have core
methods beyond the documented set — principle 2). Hover for a core/class method:
the hover handler resolves the literal receiver via `literalClass`, then looks
up `methodDocs(cls).get(word)` — no new engine API needed.

### 2. Inference-lite (P3)

**Singleton indexing (`workspace.ts`).** `indexFile`'s visitor adds
`singleton_method` (only when its `object` field is `self`) as a method `Def`
with `singleton: true`, container = enclosing namespace. `def SomeConst.x`
(non-`self` receiver) is skipped (certainty). Qualified display uses `Class.x`
(dot) for singletons vs `Class#x` for instance methods — the hover/navigation
`qualified()` helpers branch on `Def.singleton`. This adds Defs but removes
none; the vendored `DragonInput.pressed?` fixture in `client-test.ts` exists
precisely for the integration agent's new `DragonInput.pressed?` singleton
check. No fixture in the existing 49 checks defines `def self.` in a position
that any current assertion counts, so the lock holds.

**Object model — `resolve.ts` gains:**

```ts
/** Instance (default) or singleton method Defs of `qualifiedClass` AND its
 * superclass chain, nearest class first. Cached against ws.generation; cycle-
 * guarded (seen-set, as contextCandidates already does). The superclass walk is
 * class hierarchy, NOT an inference hop — always permitted. */
methodsOf(qualifiedClass: string, opts?: { singleton?: boolean }): Def[];

/** ONE explicit hop of receiver typing. Returns a core class ("Array" | "Hash"
 * | "String" | "Numeric" | "Symbol") or a workspace-qualified class name, plus
 * the origin (which gates diagnostics). null when no rule fires. */
receiverType(uri: string, receiver: Node): TypeGuess | null;
// TypeGuess = { class: string; source: "literal" | "new" | "ivar" | "return" }

/** The single literal RHS a local was assigned in `method`, if assigned exactly
 * once and never reassigned. `deriveShapes`' inherited guard only adds to
 * `reassigned` when an `assignment`'s `left` is a bare `identifier` — that was
 * sufficient for engine-owned bodies but NOT for argument-checking here: it
 * misses element-assignment (`p[:y] = 0`, left is `element_reference`) and
 * mutating calls (`p.merge!`, `p.store`), which mutate shape at runtime. So this
 * must ALSO return null when the local is the receiver of an element-assignment
 * or any mutating method call between the literal and the use — otherwise the
 * shape-check fires a false "missing key" on an uncertain type (principle 2).
 * Feeds the diagnostics shape-check extension. null otherwise. */
sameMethodLiteral(method: Node, name: string): Node | null;
```

`receiverType` rules (exactly one hop, hard-stopped):

1. **local ← literal in same method** — nearest preceding same-method
   `assignment` of `name` with a literal RHS: `[]`→Array, `{}`→Hash,
   `""`/`''`→String, integer/float→Numeric, `:sym`→Symbol. `source: "literal"`.
2. **local ← `Klass.new`** — RHS `Klass.new(...)`, `Klass` resolving via
   `resolveConstName` to a workspace class. `source: "new"`.
3. **`@ivar` ← literal|`Klass.new`** — scan the enclosing class body for
   `@ivar = …` assignments; a single consistent type wins. `source: "ivar"`.
4. **`recv.meth` return-dispatch** — the receiver is itself a call `recv.meth`
   where `meth` resolves **uniquely** in the workspace (one Def by name, or one
   after `methodsOf` on an already-known `recv` type) and that Def's doc has
   `@return [T]` with `T` resolving to a workspace class. `source: "return"`.
   This is the `camera.ui.view` case. The result is **not** re-fed to type a
   further receiver: a chain types at most the immediately-prior hop, then
   resolves the next method, then stops.

**Where inference may act (BINDING gate):**

| consumer                                                 | may use                                                                                     |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| completion, hover, definition, references, signatureHelp | any `receiverType` source + `methodsOf`                                                     |
| diagnostics (validity/arity/kwarg/shape)                 | **only** `source: "literal"` in the same method, unreassigned — never `new`/`ivar`/`return` |

In practice the sole live diagnostic extension is **argument duck-shape
checks**: `diagnostics.ts` `shapeCheck`, when an argument is an identifier
rather than a hash literal, may resolve it via `sameMethodLiteral(method, name)`
to its same-method literal hash and check that hash's shape exactly as if inline
(`p = { x: 0, y: 0 }; Geometry.distance(p, q)`). Receiver-side extension is
inert today — engine-owned receivers (Geometry/Easing) are constants, not
locals, and workspace/core receivers carry no engine signature to check against
— but the gate is stated generically so it stays correct if that changes.
`@return` dispatch never touches diagnostics.

### 3. New rules (P3) — `perf.ts`

Four rules, each **Information (severity 3)** as their _base_ severity (before
the tick-reachability gate below, which may soften a firing to **Hint (severity
4)**), certainty-gated, guide-linked via `codeDescription`. They live as pure
functions in `src/perf.ts` (alongside the tick call graph); `diagnostics.ts`
imports and runs them. The spike's
`mutationDuringIteration`/`MUTATORS`/`PERF_GUIDE` also move to `perf.ts`
unchanged in behavior.

- **array-primitives-should-be-hashes** — `args.outputs.<layer> << [ … ]` where
  the RHS is an array literal (`node.type === "array"`). Gate: receiver chain
  ends in a known **render layer** AND RHS is an array literal. The render-layer
  set is `sprites|solids|labels|lines|borders|primitives|debug` plus the
  `static_*` variants. `outputs.md` contains no `static_` token — those layer
  names come from `def static_*` in `docs/oss/dragon/outputs.rb` (or a hardcoded
  six). The derived `args.outputs` members also include `background_color` and
  `screenshots`, which are **not** append layers and must be **excluded** from
  this gate. Suggest the hash form.
- **bulk concatenation inside iteration** — `outputs.<layer> << x` or `.concat`
  lexically inside an `each`/`each_with_index`/`map`/`times`/`upto`/`downto`
  block. Gate: append target is an outputs-layer chain, and it sits within an
  iteration block. Distinct from `mutationDuringIteration` (that flags mutating
  the _iterated_ receiver; this flags per-iteration appends to outputs). Suggest
  building an array and appending once.
- **recursion notice** — a method whose body contains a self-call whose name
  equals the enclosing def's name. A self-call is any of: a receiver-less `call`
  (`foo()`), a `self.NAME` `call`, OR — the dominant zero-arg form — a bare
  `identifier` whose text equals the def name (tree-sitter parses `foo` with no
  args as an `identifier`, **not** a `call`, so a call-only match misses it).
  The bare-identifier form must be shadow-guarded: exclude the def's own name
  node, parameter/block-parameter bindings, assignment LHSs, and any name
  shadowed by a prior same-method local (reuse `resolveLocal`'s local-scan).
  Gate: exact same-name self-call within the def. Note the 60fps mruby-stack
  risk; prefer iteration.
- **unused non-final `.map`** — a `.map`-with-block call standing as its own
  statement that is **not** the last statement of its block/method body (a
  trailing `.map` is the legitimately-used return value), and whose result is
  not assigned/consumed. Tree-sitter Ruby has **no** `expression_statement`
  node, so "statement" is expressed structurally: the `map` `call` sits directly
  in a statement-list parent
  (`body_statement`/`block_body`/`then`/`else`/`ensure`/…) and has a non-null
  `nextNamedSibling`. Explicitly do **not** fire when the parent is
  `assignment`/`return`/`argument_list`/`pair`/`binary`/`call` (the result is
  consumed). Suggest `.each`. Conservative: block-form `.map` in non-final
  statement position only.

**Tick-reachability gating (`perf.ts` call graph).** Build a name-keyed call
graph over the workspace def index: for each method `Def`, edges to every def
whose name matches a self-call in its body — a receiver-less `call`, a
`self.NAME` `call`, or a bare `identifier` matching a def name (the same
zero-arg form the recursion rule handles; not shadowed by a local). Omitting the
bare-identifier form under-links zero-arg calls, which would falsely mark a hot
helper non-tick-reachable and soften its hint to Hint — the opposite of intent.
Name-level resolution deliberately over-links — that only _widens_ reachability,
keeping more hints Information, which is the conservative direction. Roots =
every method named `tick` (top-level `def tick args` and scene `def tick`). BFS
from roots. For a rule firing in method `M`:

- `M` reachable from a tick root → **Information** (hot path).
- `M` has ≥1 known caller (in-degree > 0) but is **not** tick-reachable → **Hint
  (severity 4)** (invoked somewhere, not provably per-frame → soften).
- `M` has **no** known callers (in-degree 0) → **Information** (cannot prove
  cold — may be an unmodelled entrypoint or dynamically dispatched).
- A rule firing at top level (outside any method) → **Information** (it runs).

The graph/reachability set is cached against `ws.generation` and computed once
per diagnostics pass. Cache invalidation is the existing generation bump.

**fx_demo lock verification (checked against `lsp/client-test.ts`).** In `MAIN`,
`fx_demo` is a top-level `def` that nothing calls (only `spawn_enemy` and
`Geometry.*` are called from `tick`). Its in-degree is 0 → **no known callers**
→ the reachability gate keeps its `array-manipulation` diagnostic at
**Information (3)**. The existing check (client-test line ~545) asserts the
diagnostic exists with the message substring `"while it's being iterated"` and a
`troubleshoot-performance` `codeDescription.href`; it does **not** assert
severity, and severity is unchanged. The pre-existing `mutationDuringIteration`
rule keeps identical behavior; the shared reachability gate leaves no-caller
methods at Information. Therefore this lock check keeps passing.

### 4. Manifest service (P3) — `handlers/manifest.ts`

A standalone pair over raw text (not `Ctx` — toml never enters the ruby index):

```ts
/** drenv.toml validation. Parses via utils/manifest `parseManifest`/`sourceKind`;
 * maps InvalidManifest to a diagnostic. Range: the offending `[dependencies.<name>]`
 * header line located by name scan, else a whole-file line-0 range for a parse
 * error. */
export function manifestDiagnostics(text: string): unknown[];
/** Section/key completion: top-level `[dependencies]`/`[package]`; dependency
 * keys from utils/manifest SOURCE_KINDS (github|url|git|path) plus
 * tag|branch|ref|entrypoint; `[package]` keys root|entrypoint|include. */
export function manifestCompletion(text: string, pos: Pos): unknown[];
```

The completion key sets are the manifest schema — to keep them engine-of-truth
rather than duplicated, **export `SOURCE_KINDS` from `utils/manifest.ts`** and
import it here (the other keys mirror `DependencySpec`/`PackageSpec`, documented
there). `parseManifest` throws on the first error only, so diagnostics report
one issue at a time — acceptable; re-runs on each edit surface the next.

`server.ts` routing: a document whose path basename is **`drenv.toml`** routes
to the manifest handler for diagnostics (didOpen/didChange/didSave) and
completion. **Every other `.toml` is ignored** — no diagnostics, no completion.
The ruby handlers must not touch toml, and the manifest handler must not touch
ruby; `server.ts` branches on `basename(uri) === "drenv.toml"` before ruby
dispatch. Manifest docs are not `.rb`, so they never enter the workspace index
and leave `generation`/`defs`/diagnostics for ruby untouched.

## Definition of done

1. `deno check` clean across `lsp/`.
2. `deno test -A --unstable-kv lsp/` green (new unit tests), and the full repo
   `deno test -A --unstable-kv` stays green.
3. Behavior lock: `deno run -A lsp/client-test.ts deno run -A main.ts lsp` →
   `ALL CHECKS PASSED` (49/49), and again against the compiled binary.
4. `deno fmt --check lsp/src` clean.
5. `lsp/server.ts` shrinks to wiring only (~≤200 lines); no logic left in it
   that belongs to a module.
