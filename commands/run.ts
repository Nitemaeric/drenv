import { exists } from "@std/fs";
import { join } from "@std/path";

import { findProject } from "../utils/project.ts";
import { reconcile } from "../utils/bundler.ts";
import { BUNDLE_REQUIRE } from "../utils/bundle-file.ts";

export default async function run(
  forwarded: string[] = [],
  options: { frozen?: boolean } = {},
) {
  const project = await findProject();

  // Sync dependencies when this project declares any; otherwise just launch.
  if (await exists(project.manifestPath)) {
    const { lock, needsRequireLine } = await reconcile(project, {
      log: (message) => console.log(message),
      frozen: options.frozen,
    });

    if (needsRequireLine && lock.dependencies.length > 0) {
      console.log(
        `drenv: warning — mygame/app/main.rb does not require the bundle.\n  Add: ${BUNDLE_REQUIRE}`,
      );
    }
  }

  const binary = join(
    project.root,
    Deno.build.os === "windows" ? "dragonruby.exe" : "dragonruby",
  );

  if (!await exists(binary)) {
    throw new Error(`drenv: dragonruby binary not found at ${binary}`);
  }

  const { code } = await new Deno.Command(binary, {
    args: ["mygame", ...forwarded],
    cwd: project.root,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).output();

  if (code !== 0) {
    Deno.exit(code);
  }
}
