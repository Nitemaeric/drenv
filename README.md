# drenv - DragonRuby Environment Manager

> [!WARNING]
> Windows is currently not supported. See
> [#8](https://github.com/Nitemaeric/drenv/issues/8) for more information.

**drenv** is a cross-platform CLI tool that helps you declutter your DragonRuby
installations.

**drenv** is built with [Deno](https://deno.com) and is inspired by
[rbenv](https://rbenv.org).

## Installation

For now, you can install **drenv** by downloading the executable from this
repo's releases page.

Alternatively, you can clone this repo and build the executable yourself.

```sh
deno compile --allow-read --allow-write --allow-env --unstable-kv --output=builds/drenv --target=aarch64-apple-darwin main.ts
```

> [!NOTE]
> Once **drenv** has been installed, you can seamlessly update to the latest
> version by running `drenv upgrade`.

## Help

### `drenv help [command]`

This command will display the help message for **drenv**.

Calling `drenv` without any arguments will also display this message.

```
Usage: drenv [options] [command]

CLI to manage DragonRuby environments

Options:
  -V, --version     output the version number
  -h, --help        display help for command

Commands:
  setup             Setup your shell profile to use drenv
  new <name>        Create a new DragonRuby project
  register <path>   Register a DragonRuby installation
  add <recipe>      Setup a pre-configured library
  global [version]  Get or set the global version of DragonRuby
  local [version]   Get or set the local version of DragonRuby
  versions          List out all locally installed versions of DragonRuby
  upgrade           Upgrade the version of drenv
  install [tier]    Install the latest version of drenv
  help [command]    display help for command
```

## Managng **drenv**

### `drenv setup`

This command will move the executable to your home directory and show
instructions on how to add it to your `$PATH`.

This allows you to call `drenv` from anywhere in your terminal.

### `drenv upgrade`

This command will download and upgrade your **drenv** installation to the latest
version.

## Managing DragonRuby Versions

### `drenv register <path>`

This command will copy a local DragonRuby installation at the specified path
into **drenv**'s home directory.

The path should point to the downloaded .zip file or the directory that contains
the `dragonruby` executable.

> [!IMPORTANT]
> You will need to register at least one DragonRuby installation before you can
> use **drenv** to manage DragonRuby projects.

### `drenv global [version]`

This command sets the version of DragonRuby that **drenv** will use when
creating new projects.

If you call `drenv global` without any arguments, it will display the current
global version.

### `drenv versions`

This command will list out all registered versions of DragonRuby.

```
  6.4
* 6.3
  5.32
```

## Managing DragonRuby Projects

### `drenv new <name>`

This command will create a new DragonRuby project with the specified name.

Under the hood, all **drenv** does is copy the contents of the global DragonRuby
installation into the new project directory.

### `drenv local [version]`

This command will update your current directory's DragonRuby version to the
specified version.

Under the hood, all **drenv** does is copy the contents of the global DragonRuby
installation into the current project directory, excluding the `mygame`
directory.

### `drenv add <recipe>`

This command will run a pre-configured script that sets up a library or tool for
your DragonRuby project.

Available recipes:

- [foodchain](https://github.com/pvande/foodchain) - Foodchain is a single-file
  library to help you document and install your DragonRuby game's dependencies.

---

Tested on a MacOS Macbook Pro M1 with DragonRuby standard 5.32, 6.3, 6.4, and
6.18.
