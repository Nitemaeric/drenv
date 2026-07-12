# drenv lsp — Emacs setup

Requires **drenv 0.17.0 or newer** on your `PATH` (`drenv --version`;
`drenv self-update` to upgrade) and a DragonRuby install (`drenv install`) for
engine intelligence. Untested by the drenv maintainers — reports welcome.

## eglot (built into Emacs 29+)

```elisp
(with-eval-after-load 'eglot
  (add-to-list 'eglot-server-programs
               '((ruby-mode ruby-ts-mode) . ("drenv" "lsp"))))
```

Open `mygame/app/main.rb` in your DragonRuby project and run `M-x eglot`. To
attach automatically:

```elisp
(add-hook 'ruby-mode-hook #'eglot-ensure)
(add-hook 'ruby-ts-mode-hook #'eglot-ensure)
```

The server is dormant outside DragonRuby projects (no markers → no
capabilities), so `eglot-ensure` on all Ruby is safe. eglot takes the project
root from project.el (usually the git root); the server detects `dragonruby`,
`dragonruby.exe`, or `mygame` at that root or one level down, and a root
`drenv.toml` for library repos.

## lsp-mode

```elisp
(with-eval-after-load 'lsp-mode
  (lsp-register-client
   (make-lsp-client
    :new-connection (lsp-stdio-connection '("drenv" "lsp"))
    :activation-fn (lsp-activate-on "ruby")
    :priority -1
    :server-id 'drenv)))
```

## What to try

Completions after `args.` / `Geometry.` / `[1, 2].`, hover on an engine method
(`Geometry.distance`) and on your own documented methods, `M-.` on a method
defined in another file, and diagnostics: `Geometry.nope(args)` should warn,
`Geometry.rect_navigate rec: {}` should flag the keyword.

## Troubleshooting

- Server logs go to stderr: `*EGLOT (…) stderr*` buffer (eglot) or
  `*drenv::stderr*` (lsp-mode).
- "Server crashed" / "unknown command 'lsp'": drenv older than 0.17.0.
- No completions in a fresh checkout: make sure the project root actually
  contains the markers above; scratch buffers outside a project stay dormant.
