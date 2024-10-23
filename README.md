# drenv - DragonRuby Environment Manager

> [!WARNING]
> Windows is currently not supported. See [#8](https://github.com/Nitemaeric/drenv/issues/8) for more information.

**drenv** is a cross-platform CLI tool that helps you declutter your DragonRuby
installations.

**drenv** is built with [Deno](https://deno.com) and is inspired by
[rbenv](https://rbenv.org).

## Installation

For now, you can install **drenv** by downloading the binary from this repo's
releases page.

Alternatively, you can clone this repo and build the binary yourself.

```sh
deno compile --allow-read --allow-write --allow-env --output=builds/drenv --target=aarch64-apple-darwin main.ts
```

> [!NOTE]
> Once **drenv** has been installed, you can seamlessly update to the latest
> version by running `drenv upgrade`.

## Usage

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
  global [version]  Get or set the global version of DragonRuby
  local [version]   Get or set the local version of DragonRuby
  versions          List out all locally installed versions of DragonRuby
  upgrade           Upgrade the version of drenv
  help [command]    display help for command
```

### `drenv setup`

This command will move the executable to your home directory and show
instructions on how to add it to your `$PATH`.

This allows you to call `drenv` from anywhere in your terminal.

### `drenv register <path>`

This command will copy a local DragonRuby installation at the specified path
into **drenv**'s home directory.

The path should point to the directory that contains the `dragonruby`
executable.

> [!IMPORTANT]
> You will need to register at least one DragonRuby installation before you can
> use **drenv**.

### `drenv global [version]`

This command sets the version of DragonRuby that **drenv** will use when
creating new projects.

If you call `drenv global` without any arguments, it will display the current
global version.

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

### `drenv upgrade`

This command will download and upgrade your **drenv** installation to the latest
version.

### `drenv versions`

This command will list out all registered versions of DragonRuby.

```
  5.32
  6.4
* 6.3
```

### `drenv install <version>`

This command will download and install the specified version of DragonRuby.

This will prompt you to enter your https://dragonruby.org credentials.

> [!IMPORTANT]
> This command only supports installing Indie and Pro versions of DragonRuby.

### `drenv login` - Requires support from https://dragonruby.org

This command will prompt you to enter your DragonRuby credentials and store a token for future use.

Tested on MacOS Macbook Pro M1 with DragonRuby 5.32, 6.3, and 6.4.
