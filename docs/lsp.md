# drenv lsp — DragonRuby editor intelligence (experimental)

`drenv lsp` starts a language server for DragonRuby projects. It lives inside
the drenv binary you already have — no gems, no Ruby toolchain, no stub
repositories — and derives everything from the DragonRuby version your project
actually uses.

```sh
drenv lsp        # speaks LSP over stdio (used by editors, not by hand)
```

Requires **drenv 0.17.0 or newer** — check with `drenv --version`, upgrade with
`drenv self-update`. On older versions the `lsp` command doesn't exist, so
editors report the server crashing on startup.

## What you get

- **Completions** — the full `args.*` tree (`args.outputs.`, `args.inputs.`,
  `args.audio.`, `args.events.`, …), `Geometry`/`Easing` and friends, mruby core
  methods on literal receivers (`[1, 2].`), your project's and vendored
  libraries' definitions, and one-hop typed variables (`enemies = []` →
  `enemies.` completes Array; `@anim = Animation.new` → `@anim.` completes the
  class, inherited methods included).
- **Docs on hover** — the same content docs.dragonruby.org serves, matched to
  your installed engine version; your own code's comment blocks render too, with
  YARD tags (`@param`, `@return`, `@example`, …) as rich markdown and constant
  references as clickable links.
- **Signature help** — positional/keyword parameters with the active argument
  highlighted, including paren-less calls.
- **Go to definition / references** — across `mygame/` and `vendor/`, with
  Ruby-style method resolution (own class, superclass chain, then same file) and
  method-scoped results for locals and parameters.
- **Diagnostics** — syntax errors, unknown engine methods, wrong argument
  counts, unknown or missing keywords, and shape checks (`Geometry.distance`
  wants `.x`/`.y` on both points — derived from the engine's own source).
  Performance hints from the engine's shipped performance guide appear at
  Information severity and link the guide.
- **drenv.toml** — validation and key completion for the dependency manifest.

Warnings are deliberately conservative: they only fire when the server fully
owns the receiver and the arguments are statically known. Completions are
generous; squiggles are certain.

## Editor setup

**Zed** — install the drenv extension (until it reaches the extension registry:
clone the repo and use `zed: install dev extension` on `editors/zed/`). The
server registers for Ruby and TOML globally — it stays dormant outside
DragonRuby projects, so this is safe.

**VS Code** — install the extension (until it reaches the marketplace: build the
`.vsix` from `editors/vscode/` and `code --install-extension
drenv-lsp-*.vsix`).

**Anything else** — point your editor's LSP client at command `drenv`, args
`["lsp"]`, for Ruby files. The conventional `--stdio` flag is accepted. A Neovim
config lives in [`editors/nvim/README.md`](../editors/nvim/README.md).

## How it works

- Intelligence is **derived from the installed engine**
  (`~/.drenv/versions/<version>/`): its Ruby source, its markdown docs, its
  guides. Upgrade the engine and the intelligence follows. The index is cached
  under `~/.drenv/cache/lsp/` (invalidated automatically).
- **Project detection**: the server activates when it sees `dragonruby`,
  `dragonruby.exe`, or `mygame` at the workspace root or one level down, or a
  `drenv.toml` at the root (library repos). Anything else gets an idle server
  with no capabilities — safe to enable globally.
- Vendored copies of libraries you're developing in the same workspace are
  deduplicated: navigation points at the editable source, not the vendored
  build.

## Troubleshooting

- **"Server crashed" or "unknown command 'lsp'"?** Your drenv is older than
  0.17.0 — run `drenv self-update`.
- **No engine intelligence?** Install a DragonRuby version first
  (`drenv install`). Workspace features (your code, vendored libraries) work
  without one.
- **Stale results after upgrading drenv or the engine?** Restart the language
  server (Zed: `editor: restart language server`; VS Code: reload the window).
- **Server logs** go to stderr — your editor's LSP output panel shows them.

Status: **experimental**. The full plan and architecture live in
[`lsp/PLAN.md`](../lsp/PLAN.md) and
[`lsp/src/ARCHITECTURE.md`](../lsp/src/ARCHITECTURE.md).
