# drenv for VS Code

A thin VS Code client for the [drenv](https://github.com/Nitemaeric/drenv)
language server, providing DragonRuby language intelligence for Ruby files.

> **Experimental / unpublished.** This extension is not on the VS Code
> Marketplace. Install it locally using the steps below.

## Requirements

The `drenv` binary must be on your `PATH`. The extension looks for
`drenv-lsp-spike` first, then falls back to `drenv`, and runs it as
`drenv lsp`. If neither is found you'll get an error notification and the
language server won't start.

## Local install

Build the bundle and package a `.vsix`, then install it into VS Code:

```sh
cd editors/vscode
npm install
npm run build
npx @vscode/vsce package
code --install-extension drenv-lsp-0.1.0.vsix
```

Reload VS Code and open a Ruby file in a DragonRuby project.

## Development

```sh
npm install
npm run build      # bundle src/extension.ts -> dist/extension.js
npm run watch      # rebuild on change
```
