# drenv lsp — productionization plan

> A Deno-native DragonRuby language server, bundled inside the drenv binary. No
> Solargraph, no CRuby, no stub repos — all intelligence is derived from the
> DragonRuby installation drenv already manages. This document is
> self-contained: it captures what the spike proved, the architecture, the
> design principles, and the phased path to production.

Status: **P1–P3 complete, validated** (branch `feat/lsp`). The ~1,800-line spike
server is modularized into `lsp/src/*` (P1) with the full engine index (P2) and
inference-lite + new perf rules + the `drenv.toml` service (P3) landed. 60
scripted client checks pass over stdio; field-tested in Zed via a dev extension
against the conjuration monorepo. Owner: Nitemaeric.

---

## Why this exists (and why not Solargraph)

The community path for DragonRuby editor intelligence is Solargraph + the
`dragonruby-yard-doc` stubs: it requires CRuby, a gem install, a sibling clone
of the stubs, hand-edited `.solargraph.yml`, and per-editor config — and its
canonical config _excludes_ `vendor/`, so drenv-vendored libraries get no
intelligence at all. The stubs also track latest DragonRuby, not the installed
version, and assume CRuby stdlib rather than mruby.

drenv is positioned to do better because it already manages the inputs:

- **the installed engine** (`~/.drenv/versions/<v>/`) — which ships its own Ruby
  source (`docs/oss/dragon/*.rb`), the exact markdown that docs.dragonruby.org
  serves (`docs/api/*.md`), and the guides (`docs/guides/*.md`)
- **the project layout** (`mygame/`)
- **the vendored dependency graph** (`mygame/vendor/` + the lockfile)

So `drenv lsp` derives everything from the user's actual install:
version-matched, mruby-accurate, vendor-aware, offline, zero prerequisites — one
subcommand inside the binary users already have.

## What the spike proved

Both feasibility risks retired, everything verified by a scripted LSP client
(`lsp/client-test.ts`) against the **compiled** binary:

1. **tree-sitter-ruby (WASM) inside `deno compile`** — embedded via `--include`,
   loaded from bytes (`Parser.init({ wasmBinary })` / `Language.load(bytes)`).
   ~2.2 MB added (binary ~74 MB total); ~7 ms per file parse.
2. **The full LSP surface over stdio** — 42 passing checks:
   - **Completions**: engine modules (101 `Geometry.` methods parsed from the
     installed engine source), curated `args.*` chains, mruby core methods on
     literal receivers (`[].` → 54 items), DragonRuby Array class-level variants
     (`Array.filter_map`), workspace + vendored defs.
   - **Docs**: the real markdown from `docs/api/*.md` rides completions and
     hover (the same content as docs.dragonruby.org, version-matched). Workspace
     comment blocks render as markdown with full YARD support —
     `@param`/`@return`/`@yield`/`@raise`/`@note`/`@example`/`@see`, RDoc
     `+code+` spans, multiline tag continuations — and constant references in
     types and `@see` resolve namespace-relatively (Ruby's lookup order) into
     clickable file links.
   - **Signatures**: `textDocument/signatureHelp` with active-parameter tracking
     (tree-based, works on paren-less calls); completion `detail` shows
     `distance(point_one, point_two)`.
   - **Diagnostics** (all certainty-gated):
     - syntax errors (tree-sitter error nodes)
     - method validity — `Geometry.nope` → warning naming the engine version
     - positional arity — `rotate_point` expects 2..3, got 1
     - kwarg validation — unknown names (`rec:` → "accepted: rect:, rects:, …")
       and missing required keywords
     - **duck-shape checks** — parameters' shapes derived from the engine's own
       method bodies (`distance` reads `point_one.x/.y`), verified against
       hash-literal arguments
     - perf hints from the shipped performance guide (array mutation during
       iteration), Information severity, `codeDescription` linking the guide
   - **Navigation**: go-to-definition and references across `mygame/` and
     `vendor/` (word-boundary references, ctags-quality).
   - **Container-aware resolution**: definitions record their enclosing
     namespace, kind, doc, and superclass. Def-site hovers pin the exact
     definition (`Conjuration::Animation::Clip#initialize`, its own doc); bare
     calls resolve like Ruby dispatch — enclosing class, then the superclass
     chain, then same-file — before falling back to a qualified candidate list;
     reopened namespaces collapse to one entry.
     `attr_reader`/`attr_writer`/`attr_accessor` index as documented method
     defs. Parameters, block parameters, and locals resolve within their method
     (hover shows the `@param` entry; references stay method-scoped); instance
     variables resolve to their class and borrow a same-named attr's doc.
3. **Editor integration** — Zed dev extension (`editors/zed/`, Rust→WASM,
   registers a `drenv` server id, resolves the binary from PATH). Publishable to
   Zed's registry as-is.
4. **Auto-detection (dormant mode)** — at initialize the server looks for
   `dragonruby` / `dragonruby.exe` / `mygame` at the workspace root **and one
   level down** (monorepos like conjuration keep the game in `demo/`), and
   treats a root `drenv.toml` as a library repo worth indexing. Anything else
   gets an empty-capabilities response and an idle server. The extension can
   therefore be enabled for Ruby globally: non-DragonRuby projects are
   untouched, DragonRuby projects light up with zero per-project config. Every
   detected project dir is workspace-indexed (nested `mygame/` included), and
   vendored packages whose `path:` source resolves to an indexed project root
   are **deduped** — definitions point at the one true (editable) source, not
   the vendored build artifact.

## Design principles (hold these)

1. **Engine-derived, never curated** (wherever possible). Methods, docs,
   signatures, shapes, and guide links all come from the installed engine. New
   engine version → new intelligence, automatically. Production removes the
   remaining curated pieces (see P2).
2. **Complete generously, warn conservatively.** Completions may come from
   partial knowledge; a diagnostic requires _owning the full surface_:
   - validity/arity/kwargs/shape checks fire only for fully-known receivers
     (`Geometry`, `Easing`) and literal arguments
   - `Array` gets completions but never warnings (core class methods beyond the
     documented variants exist)
   - perf rules are Information severity, never warnings
3. **Fixed feature contract.** Completion, hover, signature help, definition,
   references, diagnostics — and nothing else until those are excellent. LSP
   servers are scope gravity wells; rename, formatting, and general refactoring
   are explicitly out (see Non-goals).

## Architecture (as spiked, kept for production)

```
drenv lsp                     stdio subcommand in main.ts (bypasses
  │                           actionRunner: stdout must stay protocol-pure)
  ├─ JSON-RPC framing         hand-rolled (~80 lines), no protocol deps
  ├─ tree-sitter-ruby (wasm)  parsing, error nodes, params, shapes
  ├─ engine index             built at initialize from ~/.drenv/versions/<v>:
  │                             docs/oss/dragon/*.rb  → methods, signatures,
  │                             derived duck shapes (geometric-attr whitelist)
  │                             docs/api/*.md         → real docs, class-level
  │                             variants, doc-only (C-implemented) methods
  │                             docs/guides/*.md      → perf-rule metadata
  ├─ workspace index          defs across mygame/ + vendor/ (name → locations)
  └─ diagnostics              syntax + certainty-gated semantic checks
```

Files: `lsp/server.ts` (server), `lsp/client-test.ts` (scripted protocol client
— keep as the regression suite), `lsp/vendor/*.wasm` (embedded), `editors/zed/`
(extension).

## Production workplan

### P1 — Hardening (prereq for any release)

- **Modularize the server.** [done] Split into `lsp/server.ts` (thin entry) plus
  `lsp/src/` modules along the seams that already existed — JSON-RPC framing,
  engine index, workspace index (defs/containers/superclasses), resolution
  (locals, constants, dispatch), YARD rendering, diagnostics, and the request
  handlers — each unit-tested, with `client-test.ts` held as the behavior lock
  throughout. This was the code-quality gate the rest of the plan sits on.
- [done] Incremental `didChange` (tree-sitter edits, not full reparse),
  `didClose`, `$/cancelRequest`, position-encoding negotiation.
- [done] Workspace watching: re-index on file create/delete/rename
  (`workspace/didChangeWatchedFiles`), and re-scan `vendor/` after a lockfile
  change (bundle/add/update runs).
- **Index caching**: [done] the engine index serializes to
  `~/.drenv/cache/lsp/<version>.json` at first build; boot becomes a cache read,
  invalidated on drenv version or engine version change.
- [done] Error resilience: a parse or handler failure never kills the server.
- Editor matrix pass: Zed (done, field-tested), VS Code (extension built, not
  yet published), Neovim (config provided in `editors/nvim/`, untested locally).

### P2 — Full engine index (remove the curated pieces)

- [done] Generate the complete `args.*` tree from `docs/api/*.md` heading chain
  annotations + the OSS runtime source (`args.rb` accessors/aliases for the
  single-hop `args.` members). Nested chains (`args.inputs.mouse`,
  `args.inputs.keyboard`, controller/key variadics) are their own `api` entries;
  `args.audio` now completes engine-derived members. Behavior lock:
  `args.audio.` → `volume`, …
- [done] mruby core index — **the one documented exception to
  engine-derivation.** The engine ships only
  `docs/oss/mruby/dragonruby-mruby-*.patch` — _diffs_ against upstream mruby
  3.0.0 (`git checkout 3.0.0` per the readme), and across all 9 patches they add
  just 5 `mrb_define_method` calls (rand/srand on Kernel,
  Random#initialize/rand/srand). The full mruby core method tables
  (`each`/`map`/`reduce`/…) live in unshipped upstream mruby, so plain-mruby
  core **cannot** be engine-derived. `engine/core.ts` keeps a curated
  `CORE_BASELINE` constant (the spike's `CORE_METHODS`, renamed) for
  plain-mruby-3.0.0 core, comment-marked as this exception, and layers
  engine-derived DragonRuby core-class extensions on top: `docs/api/*.md`
  headings (instance) + `Array Class Methods` bullet lists (constant receiver),
  cross-checked against `docs/oss/dragon/*_docs.rb`. Core classes get richer
  completion/hover but never diagnostics (not in `validityReceivers`). The cache
  gains `CACHE_SCHEMA_VERSION` so a same-drenv-version change to derivation
  logic or baseline content invalidates a stale dev cache.
- [done] Hover for core/class methods — the hover handler resolves the literal
  receiver via `literalClass` and reads `methodDocs(cls)`. Behavior lock:
  `[1, 2].each` → `Array#each` engine docs.
- [done] Signatures for doc-only (C-implemented) methods, synthesized in
  `engine/md.ts` **only when unambiguous** (a single `def` fence or a single
  consistent call form); ambiguous fences stay silent (principle 2) so
  diagnostics never fire on a guessed arity.

### P3 — Inference-lite + more rules

- [done] **One-hop assignment tracking**: `enemies = []` → Array powers
  variable-receiver completion; `sameMethodLiteral` (unreassigned/unmutated,
  element-assignment- and mutator-guarded) extends the duck-shape check to
  one-hop literal variables. Diagnostics use `source: "literal"` only — never
  `new`/`ivar`/`return`. Stops at one hop.
- [done] **YARD types as an inference input**: `receiverType` rule 4 dispatches
  `recv.meth` through `meth`'s unique `@return [T]` (one hop, not re-fed).
  Behavior lock: `camera.ui.draw` resolves to `Hud#draw` via `#ui`'s
  `@return [Hud]`. Also powers `@anim = Klass.new` → `@anim.` method-chain
  completion. Inference-side extension for receivers is gated out of diagnostics
  (engine receivers are constants, not locals) — inert but stated generically.
- [done] Index singleton methods (`def self.build`, object=`self` only) as
  class-level defs displayed `Class.build`; `def SomeConst.x` skipped for
  certainty. Behavior lock: definition through `Factory.build` resolves to the
  `def self.build` site.
- [done] Tick-reachability gating for the new perf rules — a name-keyed call
  graph (`perf.ts`) from `tick` roots. Deliberately over-links (name-level) to
  keep more hints at Information; softens a firing to Hint (4) only when the
  method is provably invoked but not tick-reachable. The pre-existing
  `mutationDuringIteration` rule stays Information (3) by contract (fx_demo
  lock), so the downgrade is demonstrated on a gated rule. Behavior lock:
  bulk-concatenation in a non-tick-reached method → severity 4.
- [done] Additional guide rules (each certainty-gated, Information base
  severity): array-primitives-should-be-hashes on
  `args.outputs.<layer> << [...]` (render layers only,
  `background_color`/`screenshots` excluded); bulk concatenation inside an
  iteration block; recursion notice (bare-identifier self-call, shadow-guarded);
  unused non-final `.map` (structural statement position). Behavior lock:
  array-primitives fires on a hot path at Information.
- [done] `drenv.toml` language service (`handlers/manifest.ts`) — validation +
  section/key completion over raw text, keys derived from `utils/manifest`
  `SOURCE_KINDS`/`DependencySpec`/`PackageSpec`. `server.ts` routes on
  `basename === "drenv.toml"`; every other `.toml` is ignored, and toml never
  enters the ruby index. Behavior lock: unknown-key diagnostic, top-level
  completion, and a non-drenv `.toml` producing nothing.

### P4 — Distribution & setup UX

- `drenv lsp setup`: detect editor(s), write/print per-editor config (Zed
  `.zed/settings.json`, VS Code, Neovim lspconfig snippet), point at
  `drenv lsp`. Zero-config goal: install drenv → run one command → editor
  intelligence.
- Publish the Zed extension to the registry; ship a minimal VS Code extension
  (marketplace).
- Docs: site page + `docs/lsp.md`; demo clip via the existing Remotion pipeline
  (`demos/`).
- Release as **experimental** in a minor (`drenv lsp` clearly labeled), keep the
  client-test suite in CI (it runs offline; the engine-index tests need a
  fixture engine dir — synthesize a tiny fake version dir in tests rather than
  depending on a real install).

### P5 — Live-engine enrichment (the differentiator)

- While `drenv run` is active, the engine's httpd exposes
  `GET /dragon/lsp/pulse/` and `POST /dragon/lsp/completion/`. Detect the live
  game and merge runtime completions — this is the honest answer to
  `args.state.*` (statically unknowable; the runtime knows).
- Surface DragonRuby console warnings/exceptions as diagnostics during
  `drenv run` (same channel).

## Non-goals

- Full type inference (beyond one-hop literal tracking) — that's Solargraph's
  lane; users can run both side by side.
- Rename/refactoring, formatting, semantic highlighting.
- Supporting non-DragonRuby Ruby projects.

## Known limits (accepted, documented)

- Variables/`args.state`/method returns are untyped statically — P3 covers one
  hop; P5 covers the rest at runtime.
- References are word-boundary text scans (ctags-quality) — acceptable; a
  tree-sitter identifier query is a cheap upgrade if noise bothers anyone.
- Shape checks use a geometric-attr whitelist; non-geometric duck shapes aren't
  asserted (by design — certainty gating).

## Evidence

- Branch: `feat/lsp` — modular server (`lsp/src/*`), client tests, Zed + VS Code
  extensions, this plan.
- 60/60 scripted checks
  (`deno run -A lsp/client-test.ts deno run -A main.ts lsp`).
- Binary cost: +~2.2 MB WASM (74 MB total). Parse: ~7 ms/file. Engine index
  build: sub-second (uncached).
- Field-tested in Zed (dev extension `editors/zed/`, demo project
  `~/Code/nitemaeric/drenv-lsp-demo`): completions, docs, signature help,
  shape/kwarg/arity/validity diagnostics, perf hints, navigation.
