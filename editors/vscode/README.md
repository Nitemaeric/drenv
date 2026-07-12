# drenv — DragonRuby intelligence for VS Code

Language intelligence for [DragonRuby](https://dragonruby.org) projects,
powered by the [drenv](https://github.com/Nitemaeric/drenv) language server.
No gems, no CRuby, no stub repositories — completions, docs, and diagnostics
are derived from the DragonRuby version your project actually uses.

> **Experimental.** The language server is under active development. Feedback
> and issues are welcome on [GitHub](https://github.com/Nitemaeric/drenv/issues).

## Features

- **Completions** — the `args.*` tree, `Geometry`/`Easing`, mruby core methods
  on literal receivers, and your project's and vendored libraries' definitions.
- **Docs on hover** — the same content docs.dragonruby.org serves, matched to
  your installed engine version; your own YARD comment blocks render too.
- **Signature help** — positional and keyword parameters with the active
  argument highlighted, including paren-less calls.
- **Go to definition / references** — across `mygame/` and `vendor/`.
- **Diagnostics** — unknown methods, wrong argument counts, unknown/missing
  keywords, duck-shape checks, and performance hints from the engine's guide.
- **drenv.toml** — validation and key completion for the dependency manifest.

## Requirements

Install [drenv](https://drenv.org) **0.17.0 or newer** and make sure the
`drenv` binary is on your `PATH` (the installer drops it in `~/.drenv/bin`).
The extension runs `drenv lsp`; if `drenv` isn't found it shows an error and
stays inactive. A DragonRuby install (`drenv install`) is needed for engine
intelligence — workspace features work without one.

The server is dormant outside DragonRuby projects (it activates on
`dragonruby`, `dragonruby.exe`, `mygame`, or a `drenv.toml` at the workspace
root or one level down), so enabling it globally for Ruby is safe.

## Building from source

```sh
cd editors/vscode
npm install
npm run build              # bundle src/extension.ts -> dist/extension.js
npx @vscode/vsce package   # produce a .vsix
code --install-extension drenv-lsp-*.vsix
```

## License

MIT. See the [drenv repository](https://github.com/Nitemaeric/drenv).
