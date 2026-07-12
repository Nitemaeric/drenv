# drenv lsp — production architecture contract

This is the binding contract for modularizing the spike (`lsp/server.ts`, ~1,800
lines, the **behavior reference**) into production modules. Implementers extract
logic from the spike — behavior must not drift. The end-to-end lock is
`lsp/client-test.ts` (42 checks):
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
    resolve.ts         name/local/context resolution  → workspace, types
    yard.ts            doc rendering                  → types (ConstResolver)
    engine.ts          engine-derived index           → ruby, analyze, types
    handlers/
      completion.ts    → workspace, resolve, yard, engine
      hover.ts         → workspace, resolve, yard, engine
      navigation.ts    → workspace, resolve
      signature.ts     → workspace, engine
      diagnostics.ts   → workspace, engine, analyze
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
`renderSignature(name: string, params: Param[]): string`, and the `GEOM_ATTRS`
whitelist.

### workspace.ts

```ts
export class Workspace {
  constructor(ruby: Ruby);
  readonly defs: Map<string, Def[]>;
  /** Monotonic; bumped by indexFile/removeFile. Consumers cache against it. */
  generation: number;
  fileText(uri: string): string | undefined;
  fileTree(uri: string): Tree | undefined;
  fileUris(): Iterable<string>;
  /** The spike's indexFile visitor, verbatim behavior: containers, method/
   * class/module defs, attr_reader/writer/accessor symbol defs, superclass
   * capture, line-walk docAbove (comments are NOT reliable tree siblings). */
  indexFile(uri: string, text: string): Tree;
  removeFile(uri: string): void;
  /** Walks .rb files under roots, skipping vendored twins per skips. */
  scan(roots: string[], skips?: Set<string>): Promise<void>;
}
/** Spike's dormant/monorepo detection: markers (dragonruby, dragonruby.exe,
 * mygame) at root and one level down; root drenv.toml counts as a library. */
export function detectProjectDirs(root: string): Promise<string[]>;
/** Spike's vendorSkips: vendored packages whose lock `path:` source resolves
 * into an indexed root (reuses utils/lockfile readLock). */
export function vendorSkips(
  roots: string[],
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
  /** Qualified class/module -> Def; cached against ws.generation. */
  namespaceIndex(): Map<string, Def>;
  resolveConstName(path: string, container: string): string | null;
  resolveConst(path: string, container: string): Def | null;
  /** Bare-call candidate ranking: enclosing class, superclass chain,
   * same-file; null when no tier hits. */
  contextCandidates(uri: string, pos: Pos, found: Def[]): Def[] | null;
}
```

### yard.ts

```ts
export class YardRenderer {
  constructor(resolver: ConstResolver);
  /** Raw comment block (plain or YARD) -> markdown. Cache keyed by
   * container + raw, invalidated externally by recreating or via clear(). */
  render(raw: string, container?: string): string;
  clear(): void;
}
```

Behavior extracted verbatim: `@param`/`@return`/`@yield`/`@yieldparam`/
`@yieldreturn`/`@raise`/`@note`/`@deprecated`/`@see`/`@example`, unknown-tag
italics, indented continuations (blockquote-aware), RDoc `+code+` → backticks,
namespace-relative constant links (`renderType`, `seeLink`).

### engine.ts

```ts
export class EngineIndex {
  /** Discovers the installed engine like the spike (utils/installed-versions,
   * constants versionsPath). Returns null when no engine is installed —
   * the server still serves workspace intelligence. rootDir overrides
   * discovery for tests. */
  static build(ruby: Ruby, rootDir?: string): Promise<EngineIndex | null>;
  readonly label: string; // e.g. "7.11"
  readonly api: Map<string, ApiEntry[]>; // "Geometry", "Easing", args chains
  readonly validityReceivers: Set<string>;
  methodDocs(cls: string): Map<string, string> | undefined;
  coreMethods(cls: string): string[] | undefined;
  literalClass(prefix: string): string | null;
  readonly perfGuideHref: string | undefined;
}
```

All curated tables from the spike (ARGS_CHAINS, CORE_METHODS) move here
unchanged. Tests synthesize a fake engine dir (temp): a minimal
`docs/oss/dragon/geometry.rb`, `docs/api/array.md`, guide file — then assert
parsing, shape derivation, doc attachment.

### handlers/*

Stateless functions over a shared context:

```ts
// in types.ts or a small handlers/ctx.ts (implementer's choice, no cycles)
export type Ctx = {
  ws: Workspace;
  resolver: Resolver;
  yard: YardRenderer;
  engine: EngineIndex | null;
};
```

- `completion.ts`: `completion(ctx, uri, pos): unknown[]` — engine chains,
  literal-receiver core methods, workspace fallback with unambiguous docs.
- `hover.ts`: `hover(ctx, uri, pos): unknown` — engine api; instance/class
  variables (attr-doc borrowing); locals (`@param` doc extraction); def-site
  pinning; context candidates; reopened-namespace collapse; ambiguous list.
  Order matters — preserve the spike's branch order.
- `navigation.ts`: `definition(ctx, uri, pos)`, `references(ctx, uri, pos)` —
  local narrowing (method-scoped references), context narrowing, plain
  `{uri, range}` payloads (strip Def extras).
- `signature.ts`: `signatureHelp(ctx, uri, pos)` — tree-based active param.
- `diagnostics.ts`: `diagnostics(ctx, uri): unknown[]` — syntax errors,
  validity, arity, kwargs, duck shapes, perf hints. All gating rules
  (VALIDITY_RECEIVERS only, literal args only, Information severity for perf)
  preserved exactly, including message wording (client-test asserts on it).

### server.ts (integration, rewritten last)

Thin: parse args → `Ruby.init` → dormant detection (empty capabilities + idle
when no project markers) → build `Ctx` → `EngineIndex.build` → workspace scan →
dispatch loop over `readMessages(Deno.stdin.readable)`. didOpen/didChange
reindex + publish diagnostics; didClose drops open-file state (keep indexed defs
for on-disk files). **Every request/notification is wrapped in try/catch: a
handler failure logs to stderr and answers `null` — it must never kill the
server.** Unknown methods: respond `null` to requests, ignore notifications.
Preserve the spike's initialize response shape.

## Definition of done

1. `deno check` clean across `lsp/`.
2. `deno test -A --unstable-kv lsp/` green (new unit tests), and the full repo
   `deno test -A --unstable-kv` stays green.
3. Behavior lock: `deno run -A lsp/client-test.ts deno run -A main.ts lsp` →
   `ALL CHECKS PASSED` (42/42), and again against the compiled binary.
4. `deno fmt --check lsp/src` clean.
5. `lsp/server.ts` shrinks to wiring only (~≤200 lines); no logic left in it
   that belongs to a module.
