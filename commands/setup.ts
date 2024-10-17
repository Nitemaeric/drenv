import { exists, move } from "jsr:@std/fs";

export default async function setup() {
  const binPath = `${Deno.env.get("HOME")}/.drenv/bin/drenv`;
  const shell = Deno.env.get("SHELL");

  if (await exists(binPath)) {
    return "drenv: already installed";
  } else {
    if (!Deno.execPath().includes("drenv")) {
      return "drenv: this command must be run from the drenv executable"
    }

    await move(Deno.execPath(), binPath);

    console.log(`Installed at ${binPath}\n`);
    console.log(`Run the following to add drenv to your shell profile:\n`);

    if (shell?.includes("zsh")) {
      console.log(`echo 'export PATH="$HOME/.drenv/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc`);
    } else if (shell?.includes("bash")) {
      console.log(`echo 'export PATH="$HOME/.drenv/bin:$PATH"' >> ~/.bashrc && source ~/.bashrc`);
    }
  }
}
