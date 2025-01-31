import { exists } from "@std/fs";

/**
 * @param directoryPath - The path to the DragonRuby installation directory.
 */
export const versionCommand = async (directoryPath: string) => {
  if (!await exists(directoryPath + "/dragonruby")) {
    throw new Error(
      "drenv: <path> is missing dragonruby executable",
    );
  }

  const command = new Deno.Command(directoryPath + "/dragonruby", {
    args: ["--version"],
  });

  const { stdout } = await command.output();

  return new TextDecoder().decode(stdout).trim();
};
