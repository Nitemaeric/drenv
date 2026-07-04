# drenv - DragonRuby Environment Manager

**drenv** is a cross-platform CLI tool that helps you declutter your DragonRuby
installations.

**drenv** is built with [Deno](https://deno.com) and is inspired by
[rbenv](https://rbenv.org).

## Installation

Install the latest release with the install script, which downloads the right
binary for your platform, drops it in `~/.drenv/bin`, and prints the line to add
to your `$PATH`:

```sh
# macOS / Linux
curl -fsSL drenv.org/install.sh | bash
```

```powershell
# Windows (PowerShell)
irm https://drenv.org/install.ps1 | iex
```

Prefer to do it by hand? Download the executable for your platform from the
[releases page](https://github.com/Nitemaeric/drenv/releases), move it to
`~/.drenv/bin`, and add that directory to your `$PATH`.

> [!NOTE]
> On macOS, if you see a Gatekeeper warning, run:
>
> ```sh
> xattr -d com.apple.quarantine ./drenv
> ```

> [!NOTE]
> Once installed, keep **drenv** up to date by running `drenv self-update`.

Alternatively, you can build from source:

```sh
deno compile -A --unstable-kv --output=builds/drenv --target=aarch64-apple-darwin main.ts
```

## Getting Started

### 1. Install DragonRuby

```sh
drenv install
```

drenv asks which tier you own (standard, indie, or pro) and remembers it, then
downloads the latest DragonRuby GTK. Standard comes from your
[itch.io](https://itch.io) account (stored as a revocable API key, never a
plaintext password); indie and pro come from
[dragonruby.org](https://dragonruby.org) via your account email and password.

> [!NOTE]
> `drenv install` requires a DragonRuby GTK purchase — itch.io for standard, a
> dragonruby.org subscription for indie/pro.

### 2. Set a global version

```sh
drenv global <version>
```

### 3. Create a project

```sh
drenv new my-game
```

---

## Managing DragonRuby Versions

### `drenv install`

Downloads and installs the latest DragonRuby GTK. Prompts for your tier the
first time and remembers it; pass `--tier standard|indie|pro` to choose or
switch. Standard downloads from itch.io, indie and pro from dragonruby.org.

Tiers are installed side by side. Each version+tier gets its own directory —
standard keeps the bare version (`7.11`), while indie and pro are suffixed
(`7.11-pro`, `7.11-indie`) — so installing pro doesn't clobber your standard
copy of the same version.

### `drenv register <path>`

Registers a local DragonRuby installation manually. The path can be a `.zip`
file or a directory containing the `dragonruby` executable. Useful if you
already have a copy downloaded. Pass `--tier indie|pro` to file it under that
tier (defaults to `standard`).

### `drenv global [version]`

Sets the global DragonRuby version used when creating new projects. Running
without arguments prints the current global version.

A bare version resolves to the highest tier you have installed. So `7.11` picks
`7.11-pro` if present, then `7.11-indie`, then `7.11` (standard). To pin a tier,
name it — `7.11-pro`, or `7.11-standard` for the standard build. The same
resolution applies anywhere a version is accepted (`new --version`, `use`), and
`drenv use` with no version switches to your highest installed tier.

### `drenv versions`

Lists all registered versions, with the current local version marked and each
tier labelled:

```
  7.11 Pro
* 6.4
  5.32
```

## Managing DragonRuby Projects

### `drenv new <name>`

Creates a new DragonRuby project by copying a registered version into a new
directory, and writes a project `.gitignore` (covering the DragonRuby binaries,
`builds/`, `tmp/`, `logs/`, docs, and samples). Uses the global version by
default; pass `--version <version>` for a specific one (tier-resolved, so
`--version 7.11-pro` works too), or `--skip-gitignore` to skip writing the
`.gitignore`.

### `drenv use [version]`

Switches the current project to a registered DragonRuby version, preserving the
`mygame` directory. Defaults to the latest installed version; pass a version
(tier-resolved, e.g. `drenv use 7.11-pro`) for a specific one. Asks for
confirmation first.

### `drenv run [args...]`

Syncs the current project's dependencies and launches it with DragonRuby. While
the game runs, drenv watches any `path:` dependencies and re-vendors them as you
edit, so changes hot-reload into the running game — handy when developing a
library alongside it. Pass `--no-watch` to turn that off (`--frozen` skips it
too). Extra arguments are forwarded to the `dragonruby` binary.

## Managing Dependencies

drenv vendors dependencies into your game, bundler-style. Declare them in
`mygame/drenv.toml` and drenv resolves them into `mygame/vendor/`, pins them in
`mygame/drenv.lock`, and generates `mygame/app/drenv_bundle.rb` with the
matching `require` lines.

```toml
# mygame/drenv.toml
[dependencies.conjuration]
github = "Nitemaeric/conjuration"   # entrypoint resolved from the library

[dependencies.draco]
github = "guitsaru/draco"
tag = "v0.7.0"
entrypoint = "draco.rb"             # ...or pin it explicitly

[dependencies.local_lib]
path = "../local_lib"
```

Each dependency declares exactly one source — `github`, `url`, `git`, or `path`.
The `entrypoint` is optional: drenv resolves it from the library's own
[`[package]`](#publishing-a-library) declaration, or by convention
(`lib/<name>.rb`, then `<name>.rb`). You can edit `drenv.toml` by hand or manage
it with `drenv add` / `drenv remove`. Either way, add a single line to the top
of `mygame/app/main.rb`:

```ruby
require 'app/drenv_bundle.rb'
```

Commit `drenv.toml` and `drenv.lock`. drenv keeps `mygame/vendor/` out of
version control for you with a generated `vendor/.gitignore`, since vendored
dependencies are reproducible from the lockfile.

### `drenv add <source>`

Adds a dependency to `mygame/drenv.toml` and vendors it. The source is
`kind:value`:

```sh
drenv add github:Nitemaeric/conjuration        # entrypoint resolved for you
drenv add github:guitsaru/draco@v0.7.0
drenv add git:https://gitlab.com/me/my_engine.git --branch main
drenv add path:../local_lib
```

Pass `-e, --entrypoint` only when the library doesn't declare or follow a
conventional entrypoint, `-n, --name` to override the derived name, and
`--tag`/`--branch`/`--ref` to pin a `github`/`git` revision.

### `drenv remove <name>`

Removes a dependency from `mygame/drenv.toml`, deletes its vendored copy, and
updates the lock.

### `drenv bundle`

Resolves every dependency in `mygame/drenv.toml`, vendors it into
`mygame/vendor/`, and writes `mygame/drenv.lock` and
`mygame/app/drenv_bundle.rb`. `drenv run` does this for you before launching;
run it directly when you only want to refresh dependencies. Pass `--frozen`
(also valid on `drenv run`) to verify against the lockfile without updating it —
handy in CI.

### `drenv publish [args...]`

Verifies dependencies against the lockfile (like `--frozen`), then runs
`dragonruby-publish` on `mygame`, forwarding any arguments. So
`drenv publish --package` packages locally and `drenv publish` publishes to
itch.io — always shipping exactly what's locked.

### Publishing a library

If you maintain a DragonRuby library, add a `[package]` section to a
`drenv.toml` at your repo root so consumers can `drenv add` it with no extra
flags:

```toml
[package]
root = "lib"                  # only this directory is vendored (default ".")
entrypoint = "conjuration.rb" # the file to require, relative to root
```

Without it, drenv falls back to convention — `lib/<name>.rb`, then `<name>.rb` —
so many libraries (a `lib/<name>.rb` layout) work with zero configuration.

## Managing drenv

### `drenv self-update`

Downloads and installs the latest version of **drenv**, replacing the current
binary in place.

---

Tested on macOS (Apple Silicon) with DragonRuby standard 5.32, 6.3, 6.4, and
6.18.
