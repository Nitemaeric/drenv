# drenv lsp — productionization plan

> A Deno-native DragonRuby language server, bundled inside the drenv binary. No
> Solargraph, no CRuby, no stub repos — all intelligence is derived from the
> DragonRuby installation drenv already manages. This document is
> self-contained: it captures what the spike proved, the architecture, the
> design principles, and the phased path to production.

Status: **spike complete, validated** (branch `spike/lsp`, ~700-line server, 21
scripted client checks passing against the compiled binary, field-tested in Zed
via a dev extension). Owner: Nitemaeric.

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
2. **The full LSP surface over stdio** — 21 passing checks:
   - **Completions**: engine modules (101 `Geometry.` methods parsed from the
     installed engine source), curated `args.*` chains, mruby core methods on
     literal receivers (`[].` → 54 items), DragonRuby Array class-level variants
     (`Array.filter_map`), workspace + vendored defs.
   - **Docs**: the real markdown from `docs/api/*.md` rides completions and
     hover (the same content as docs.dragonruby.org, version-matched).
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

- Incremental `didChange` (tree-sitter supports edits; spike reparses fully),
  `didClose`, `$/cancelRequest`, position-encoding negotiation.
- Workspace watching: re-index on file create/delete/rename
  (`workspace/didChangeWatchedFiles`), and re-scan `vendor/` after
  bundle/add/update runs.
- **Index caching**: serialize the engine index to
  `~/.drenv/cache/lsp/<version>.json` at first build; boot becomes a cache read.
  Invalidate on drenv version or engine version change.
- Error resilience: a parse or handler failure must never kill the server.
- Editor matrix pass: Zed (done), Neovim, VS Code (needs a thin extension — same
  shape as the Zed one).

### P2 — Full engine index (remove the curated pieces)

- Generate the complete `args.*` tree (the spike hardcodes ~4 chains) from
  `docs/api/*.md` headings + the OSS runtime source; include `args.audio`,
  `args.grid`, `args.gtk`, `args.events`, mouse/touch, etc.
- mruby core index generated from mruby source at the engine's mruby version
  (the engine ships `docs/oss/mruby/dragonruby-mruby-*.patch`), replacing the
  curated CORE_METHODS tables. Includes DragonRuby's core-class extensions
  parsed from the engine (`docs/oss/dragon/*_docs.rb`, runtime files).
- Hover for core/class methods (currently completions-only).
- Signatures for doc-only (C-implemented) methods where the docs' code fences
  make them unambiguous.

### P3 — Inference-lite + more rules

- **One-hop assignment tracking**: `enemies = []` → Array. Powers
  variable-receiver completions AND extends shape/arity checks to one-hop
  literal variables. Explicitly stop at one hop.
- Tick-reachability gating for perf rules (workspace call graph from the def
  index), so per-frame hints only fire where they're hot.
- Additional guide rules (each certainty-gated, Information severity):
  array-primitives-should-be-hashes on `args.outputs.* << [...]`; bulk
  concatenation (`outputs << x` inside `.each`); recursion notice; unused `.map`
  (conservative: non-final statement only).
- `drenv.toml` language service (completion/validation — drenv owns the schema;
  reuse `parseManifest` validation).

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

- Branch: `spike/lsp` — server, client tests, Zed extension, this plan.
- 21/21 scripted checks against the compiled binary
  (`deno run -A
  lsp/client-test.ts ~/.drenv/bin/drenv-lsp-spike lsp`).
- Binary cost: +~2.2 MB WASM (74 MB total). Parse: ~7 ms/file. Engine index
  build: sub-second (uncached).
- Field-tested in Zed (dev extension `editors/zed/`, demo project
  `~/Code/nitemaeric/drenv-lsp-demo`): completions, docs, signature help,
  shape/kwarg/arity/validity diagnostics, perf hints, navigation.
