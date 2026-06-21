# drenv - DragonRuby Environment Manager

**drenv** is a cross-platform CLI tool that helps you declutter your DragonRuby
installations.

**drenv** is built with [Deno](https://deno.com) and is inspired by
[rbenv](https://rbenv.org).

## Installation

Download the executable for your platform from the
[releases page](https://github.com/Nitemaeric/drenv/releases), then run:

```sh
drenv setup
```

This moves the executable to `~/.drenv/bin` and prints the line to add to your
shell profile.

> [!NOTE]
> On macOS, if you see a Gatekeeper warning, run:
>
> ```sh
> xattr -d com.apple.quarantine ./drenv
> ```

> [!NOTE]
> Once installed, keep **drenv** up to date by running `drenv upgrade`.

Alternatively, you can build from source:

```sh
deno compile -A --unstable-kv --output=builds/drenv --target=aarch64-apple-darwin main.ts
```

## Getting Started

### 1. Install DragonRuby

```sh
drenv install
```

This signs into your [itch.io](https://itch.io) account and downloads the latest
version of DragonRuby GTK. Your credentials are stored as a revocable API key —
never as a plaintext password.

> [!NOTE]
> `drenv install` requires a DragonRuby GTK purchase on itch.io. Only the
> standard tier is supported at this time.

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

### `drenv install [tier]`

Downloads and installs the latest version of DragonRuby GTK from itch.io.

### `drenv register <path>`

Registers a local DragonRuby installation manually. The path can be a `.zip`
file or a directory containing the `dragonruby` executable. Useful if you
already have a copy downloaded.

### `drenv global [version]`

Sets the global DragonRuby version used when creating new projects. Running
without arguments prints the current global version.

### `drenv versions`

Lists all registered versions, with the current local version marked:

```
  6.4
* 6.3
  5.32
```

## Managing DragonRuby Projects

### `drenv new <name>`

Creates a new DragonRuby project by copying the global version into a new
directory.

### `drenv update [version]`

Updates the current directory's DragonRuby version, preserving the `mygame`
directory.

### `drenv run [args...]`

Syncs the current project's dependencies and launches it with DragonRuby. Any
extra arguments are forwarded to the `dragonruby` binary.

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

Commit `drenv.toml` and `drenv.lock`, and add `mygame/vendor/` to your
`.gitignore`.

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

### `drenv setup`

Moves the **drenv** executable to `~/.drenv/bin` and shows instructions for
adding it to your `$PATH`.

### `drenv upgrade`

Downloads and installs the latest version of **drenv**.

---

Tested on macOS (Apple Silicon) with DragonRuby standard 5.32, 6.3, 6.4, and
6.18.
