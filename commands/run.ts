import { exists } from "@std/fs";

import { findProject } from "../utils/project.ts";
import { dragonrubyBinary } from "../utils/version.ts";
import { reconcile } from "../utils/bundler.ts";
import { BUNDLE_REQUIRE } from "../utils/bundle-file.ts";
import { watchPathDeps } from "../utils/watch.ts";

export default async function run(
  forwarded: string[] = [],
  options: { frozen?: boolean; watch?: boolean } = {},
) {
  const project = await findProject();
  const log = (message: string) => console.log(message);
  const hasManifest = await exists(project.manifestPath);

  // Sync dependencies when this project declares any; otherwise just launch.
  if (hasManifest) {
    const { lock, needsRequireLine } = await reconcile(project, {
      log,
      frozen: options.frozen,
    });

    if (needsRequireLine && lock.dependencies.length > 0) {
      console.log(
        `drenv: warning — mygame/app/main.rb does not require the bundle.\n  Add: ${BUNDLE_REQUIRE}`,
      );
    }
  }

  const binary = dragonrubyBinary(project.root);

  if (!await exists(binary)) {
    throw new Error(`drenv: dragonruby binary not found at ${binary}`);
  }

  const child = new Deno.Command(binary, {
    args: ["mygame", ...forwarded],
    cwd: project.root,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();

  // Re-sync path dependencies as they change so edits hot-reload into the game.
  const controller = new AbortController();
  const watching = hasManifest && options.watch !== false && !options.frozen
    ? watchPathDeps(project, controller.signal, log)
    : Promise.resolve();

  const { code } = await child.status;
  controller.abort();
  await watching.catch(() => {});

  if (code !== 0) {
    Deno.exit(code);
  }
}
