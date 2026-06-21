import { exists } from "@std/fs";
import { join } from "@std/path";

import { findProject } from "../utils/project.ts";
import { reconcile } from "../utils/bundler.ts";
import { BUNDLE_REQUIRE } from "../utils/bundle-file.ts";

export default async function publish(forwarded: string[] = []) {
  const project = await findProject();

  // Verify dependencies against the lockfile and vendor them into the package.
  // Frozen so a publish always ships exactly what's locked.
  if (await exists(project.manifestPath)) {
    const { lock, needsRequireLine } = await reconcile(project, {
      log: (message) => console.log(message),
      frozen: true,
    });

    if (needsRequireLine && lock.dependencies.length > 0) {
      console.log(
        `drenv: warning — mygame/app/main.rb does not require the bundle.\n  Add: ${BUNDLE_REQUIRE}`,
      );
    }
  }

  const binary = join(
    project.root,
    Deno.build.os === "windows"
      ? "dragonruby-publish.exe"
      : "dragonruby-publish",
  );

  if (!await exists(binary)) {
    throw new Error(`drenv: dragonruby-publish binary not found at ${binary}`);
  }

  // dragonruby-publish takes the game directory last: [flags...] GAME_DIRECTORY
  const { code } = await new Deno.Command(binary, {
    args: [...forwarded, "mygame"],
    cwd: project.root,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).output();

  if (code !== 0) {
    Deno.exit(code);
  }
}
