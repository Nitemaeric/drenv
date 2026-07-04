# drenv

**drenv** manages your DragonRuby installs and your game's dependencies — think
[rbenv](https://rbenv.org) and Bundler, for
[DragonRuby](https://dragonruby.org).

- Install and switch between DragonRuby versions — standard, indie, and pro,
  side by side.
- Scaffold new projects and pin each one to a version.
- Vendor Ruby dependencies into your game, reproducibly.

## Install

```sh
# macOS / Linux
curl -fsSL drenv.org/install.sh | bash
```

```powershell
# Windows (PowerShell)
irm https://drenv.org/install.ps1 | iex
```

The script drops the binary in `~/.drenv/bin` and prints the line to add to your
`$PATH`. Update any time with `drenv self-update`.

<details>
<summary>Manual install / macOS Gatekeeper</summary>

Download a binary from the
[releases page](https://github.com/Nitemaeric/drenv/releases), move it to
`~/.drenv/bin`, and add that directory to your `$PATH`. On macOS, clear the
quarantine flag if you're warned:

```sh
xattr -d com.apple.quarantine ./drenv
```

</details>

## Quick start

```sh
drenv install        # download DragonRuby (asks which tier you own)
drenv new my-game    # scaffold a project on that version
cd my-game
drenv run            # launch it
```

`drenv new` uses your newest install by default, so it just works. Have more
than one version or tier? They live side by side — `drenv versions` lists them,
and both `new --version <v>` and `drenv use <v>` take a specific one. See
[Managing versions](docs/versions.md) for tiers and version resolution.

> [!NOTE]
> `drenv install` needs a DragonRuby purchase — [itch.io](https://itch.io) for
> standard, a [dragonruby.org](https://dragonruby.org) subscription for
> indie/pro.

## Dependencies

drenv vendors Ruby libraries into your game, Bundler-style. Add one:

```sh
drenv add github:Nitemaeric/conjuration
```

then require the generated bundle once, at the top of `mygame/app/main.rb`:

```ruby
require 'app/drenv_bundle.rb'
```

`drenv run` re-vendors everything before launching. Commit `drenv.toml` and
`drenv.lock` — the vendored copies are reproducible from the lockfile and stay
out of git. See [Managing dependencies](docs/dependencies.md) for the
`drenv.toml` format, entrypoint resolution, publishing a library, and CI.

## Commands

Run `drenv <command> --help` for flags and details.

**Engine management**

| Command               | Description                                     |
| --------------------- | ----------------------------------------------- |
| `install`             | Download the latest DragonRuby (prompts a tier) |
| `register <path>`     | Register a local install (a `.zip` or a folder) |
| `uninstall <version>` | Remove an installed version                     |
| `versions`            | List installed versions                         |
| `changelog [ver]`     | Print a version's changelog                     |

**Project management**

| Command           | Description                                    |
| ----------------- | ---------------------------------------------- |
| `new <name>`      | Scaffold a new project                         |
| `use [version]`   | Switch the current project's version           |
| `version`         | Print the current project's version            |
| `run [args...]`   | Vendor dependencies and launch the game        |
| `publish [args…]` | Verify dependencies, then `dragonruby-publish` |

**Dependency management**

| Command         | Description                                |
| --------------- | ------------------------------------------ |
| `add <source>`  | Add and vendor a dependency                |
| `remove <name>` | Remove a dependency                        |
| `bundle`        | Re-vendor from `drenv.toml` / the lockfile |

**Managing drenv**

| Command       | Description         |
| ------------- | ------------------- |
| `self-update` | Update drenv itself |

---

Built with [Deno](https://deno.com). Tested on macOS (Apple Silicon) with
DragonRuby 5.32, 6.3, 6.4, 6.18, and 7.11.
