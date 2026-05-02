import { ensureDir, exists, move } from "@std/fs";

import { binPath, drenvBinPath, shell } from "../constants.ts";

export default async function setup() {
  if (await exists(binPath)) {
    return "drenv: already installed";
  }

  if (!Deno.execPath().includes("drenv")) {
    return "drenv: this command must be run from the drenv executable";
  }

  await ensureDir(binPath);
  await move(Deno.execPath(), drenvBinPath);

  console.log(`Installed at ${drenvBinPath}\n`);
  console.log(`Run the following to add drenv to your shell profile:\n`);

  if (Deno.build.os === "windows") {
    console.log(
      `[Environment]::SetEnvironmentVariable("Path", [Environment]::GetEnvironmentVariable("Path", "User") + ";$HOME\\.drenv\\bin", "User"); $env:Path += ";$HOME\\.drenv\\bin"`,
    );
  } else if (shell?.includes("zsh")) {
    console.log(
      `echo 'export PATH="$HOME/.drenv/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc`,
    );
  } else if (shell?.includes("bash")) {
    console.log(
      `echo 'export PATH="$HOME/.drenv/bin:$PATH"' >> ~/.bashrc && source ~/.bashrc`,
    );
  }
}
