import { exists } from "@std/fs";
import { join } from "@std/path";

export const dragonrubyBinary = (directoryPath: string) =>
  join(
    directoryPath,
    Deno.build.os === "windows" ? "dragonruby.exe" : "dragonruby",
  );

/**
 * @param directoryPath - The path to the DragonRuby installation directory.
 */
export const versionCommand = async (directoryPath: string) => {
  const binary = dragonrubyBinary(directoryPath);

  if (!await exists(binary)) {
    throw new Error(
      "drenv: <path> is missing dragonruby executable",
    );
  }

  const command = new Deno.Command(binary, {
    args: ["--version"],
  });

  const { stdout } = await command.output();

  return new TextDecoder().decode(stdout).trim();
};
