# drenv.org

The marketing site and install-script host for
[drenv](https://github.com/Nitemaeric/drenv), built with
[Fresh](https://fresh.deno.dev).

## Develop

```sh
deno task start
```

Watches `routes/` and `static/` and reloads on change.

## Routes

- `/` — landing page ([routes/index.tsx](routes/index.tsx))
- `/docs` — command reference ([routes/docs/index.tsx](routes/docs/index.tsx))
- `/install.sh`, `/install.ps1` — redirect to the install scripts at the repo
  root (the single source of truth)

Interactive bits (the OS-aware install command + copy button) live in `islands/`
so they hydrate in the browser; routes are otherwise static.

## Build

```sh
deno task build     # production build
deno task preview   # serve the build
deno task check     # fmt + lint + type-check
```
