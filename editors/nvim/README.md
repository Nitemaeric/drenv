# drenv LSP — Neovim setup

DragonRuby language intelligence in Neovim, served by `drenv lsp`. No
Solargraph, no CRuby, no stubs — the same server the Zed extension uses.

The server is **dormant outside DragonRuby projects**: on `initialize` it looks
for `dragonruby` / `dragonruby.exe` / `mygame` / `drenv.toml` at the workspace
root (and one level down, for monorepos), and returns empty capabilities and an
idle server for anything else. Enabling it globally for Ruby is therefore safe —
plain Ruby projects are untouched.

## Prerequisites

- Neovim **>= 0.11** (for the native `vim.lsp.config` / `vim.lsp.enable` API).
- `drenv` on your `PATH`. If you installed drenv the usual way, add
  `~/.drenv/bin` to your `PATH`. The config below prefers a `drenv-lsp-spike`
  binary while the spike branch exists and falls back to `drenv` once
  `drenv lsp` ships in the main binary.

## Neovim >= 0.11 (native API)

Drop this in your config (e.g. `~/.config/nvim/init.lua`, or a file under
`~/.config/nvim/lua/` that you `require`):

```lua
-- Prefer the spike binary while it exists; fall back to `drenv` once
-- `drenv lsp` ships in the main binary.
local drenv = vim.fn.exepath("drenv-lsp-spike")
if drenv == "" then
  drenv = vim.fn.exepath("drenv")
end

if drenv ~= "" then
  vim.lsp.config("drenv", {
    cmd = { drenv, "lsp" },
    filetypes = { "ruby" },
    root_markers = {
      "dragonruby",
      "dragonruby.exe",
      "mygame",
      "drenv.toml",
      ".git",
    },
  })

  vim.lsp.enable("drenv")
end
```

`vim.lsp.enable("drenv")` attaches the server to every `ruby` buffer. Because
the server goes dormant in non-DragonRuby workspaces, this is safe to leave on
globally.

## Legacy (`nvim-lspconfig`, Neovim < 0.11)

If you are on an older Neovim or already drive everything through
[`nvim-lspconfig`](https://github.com/neovim/nvim-lspconfig), register a custom
config:

```lua
local lspconfig = require("lspconfig")
local configs = require("lspconfig.configs")

local drenv = vim.fn.exepath("drenv-lsp-spike")
if drenv == "" then
  drenv = vim.fn.exepath("drenv")
end

if drenv ~= "" and not configs.drenv then
  configs.drenv = {
    default_config = {
      cmd = { drenv, "lsp" },
      filetypes = { "ruby" },
      root_dir = lspconfig.util.root_pattern(
        "dragonruby",
        "dragonruby.exe",
        "mygame",
        "drenv.toml",
        ".git"
      ),
    },
  }
end

if configs.drenv then
  lspconfig.drenv.setup({})
end
```

## Verifying

Open a DragonRuby project (one with `mygame/` or a `dragonruby` binary at the
root) and edit a Ruby file, then run `:checkhealth vim.lsp` or `:LspInfo`
(lspconfig) — you should see the `drenv` client attached. Try completing
`Geometry.` or hovering an engine method to confirm intelligence is live. In a
plain Ruby project, the client attaches but stays idle (no capabilities) by
design.

## Status

This config is **untested on the machine it was authored on** (Neovim is not
installed there). It mirrors the server command the field-tested Zed extension
uses (`drenv-lsp-spike` → `drenv`, arg `lsp`). Please report issues if the
root-marker or filetype wiring needs adjustment for your setup.
