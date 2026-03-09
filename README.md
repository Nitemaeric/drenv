# drenv - DragonRuby Environment Manager

> [!WARNING]
> Windows is currently not supported. See
> [#8](https://github.com/Nitemaeric/drenv/issues/8) for more information.

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

This signs into your [itch.io](https://itch.io) account and downloads the
latest version of DragonRuby GTK. Your credentials are stored as a revocable
API key — never as a plaintext password.

> [!NOTE]
> `drenv install` requires a DragonRuby GTK purchase on itch.io.
> Only the standard tier is supported at this time.

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

### `drenv local [version]`

Updates the current directory's DragonRuby version, preserving the `mygame`
directory.

### `drenv add <recipe>`

Installs a pre-configured library into your project.

Available recipes:

- [foodchain](https://github.com/pvande/foodchain) - a single-file dependency
  manager for DragonRuby games.

## Managing drenv

### `drenv setup`

Moves the **drenv** executable to `~/.drenv/bin` and shows instructions for
adding it to your `$PATH`.

### `drenv upgrade`

Downloads and installs the latest version of **drenv**.

---

Tested on macOS (Apple Silicon) with DragonRuby standard 5.32, 6.3, 6.4, and 6.18.
