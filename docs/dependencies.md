# Managing dependencies

drenv vendors dependencies into your game, Bundler-style. Declare them in
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

## Commands

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

### `drenv run [args...]`

Syncs dependencies, then launches the project with DragonRuby. While the game
runs, drenv watches any `path:` dependencies and re-vendors them as you edit, so
changes hot-reload into the running game — handy when developing a library
alongside it. Pass `--no-watch` to turn that off (`--frozen` skips it too).
Extra arguments are forwarded to the `dragonruby` binary.

### `drenv publish [args...]`

Verifies dependencies against the lockfile (like `--frozen`), then runs
`dragonruby-publish` on `mygame`, forwarding any arguments. `drenv publish`
ships to itch.io and `drenv publish --package` packages locally — always
shipping exactly what's locked.

## Publishing a library

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
