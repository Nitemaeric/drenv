import { ensureDir, exists, move } from "@std/fs";

import { binPath, shell } from "../constants.ts";

export default async function setup() {
  const drenvPath = `${binPath}/drenv`;

  if (await exists(binPath)) {
    return "drenv: already installed";
  } else {
    if (!Deno.execPath().includes("drenv")) {
      return "drenv: this command must be run from the drenv executable";
    }

    await ensureDir(binPath);
    await move(Deno.execPath(), drenvPath);

    console.log(`Installed at ${drenvPath}\n`);
    console.log(`Run the following to add drenv to your shell profile:\n`);

    if (shell?.includes("zsh")) {
      console.log(
        `echo 'export PATH="$HOME/.drenv/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc`,
      );
    } else if (shell?.includes("bash")) {
      console.log(
        `echo 'export PATH="$HOME/.drenv/bin:$PATH"' >> ~/.bashrc && source ~/.bashrc`,
      );
    }
  }
}
