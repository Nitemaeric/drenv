# Managing DragonRuby versions

drenv keeps every DragonRuby install under `~/.drenv/versions` and lets you pick
which one each project uses.

## Tiers install side by side

`drenv install` prompts for your tier the first time and remembers it; pass
`--tier standard|indie|pro` to choose or switch. Standard downloads from
[itch.io](https://itch.io) (stored as a revocable API key, never a plaintext
password); indie and pro from [dragonruby.org](https://dragonruby.org) (your
account email is cached, and only the password is prompted for).

Each version+tier gets its own directory — standard keeps the bare version
(`7.11`), while indie and pro are suffixed (`7.11-pro`, `7.11-indie`) — so
installing pro doesn't clobber your standard copy of the same version.

## Referring to a version

A bare version resolves to the **highest tier you have installed**: `7.11` picks
`7.11-pro` if present, then `7.11-indie`, then `7.11` (standard). To pin a tier,
name it — `7.11-pro`, or `7.11-standard` for the standard build. This resolution
applies everywhere a version is accepted (`new --version`, `use`). With no
version, `new` and `use` both default to your newest install (highest version,
highest tier).

## Commands

### `drenv install [--tier <tier>]`

Downloads and installs the latest DragonRuby GTK. Prompts for your tier the
first time and remembers it. Requires a DragonRuby purchase — itch.io for
standard, a dragonruby.org subscription for indie/pro.

### `drenv register <path> [--tier <tier>]`

Registers a local install manually. The path can be a `.zip` file or a directory
containing the `dragonruby` executable — handy if you already have a copy
downloaded. Pass `--tier indie|pro` to file it under that tier (defaults to
`standard`).

### `drenv uninstall <version>`

Removes an installed version from `~/.drenv/versions`. The version is
tier-resolved (`7.11` picks your highest tier, `7.11-pro` pins it), and drenv
prompts for confirmation showing exactly what will be removed; pass `-y`/`--yes`
to skip the prompt (for scripts). Existing projects are unaffected — they carry
their own copy of DragonRuby.

### `drenv versions`

Lists all installed versions, with the current project's version marked and each
tier labelled:

```
  7.11 Pro
* 6.4
  5.32
```

### `drenv changelog [version]`

Prints the changelog entry for a version (defaults to the latest installed).

### `drenv use [version]`

Switches the current project to a registered version, preserving the `mygame`
directory. Defaults to your highest installed tier; pass a version
(tier-resolved, e.g. `drenv use 7.11-pro`) for a specific one. Asks for
confirmation first.
