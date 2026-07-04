import { exists } from "@std/fs";

import { findProject } from "../utils/project.ts";
import { readManifest, sourceKind } from "../utils/manifest.ts";
import { readLock } from "../utils/lockfile.ts";
import { remoteRef } from "../utils/sources/mod.ts";

const shortRef = (ref: string): string => ref.slice(0, 7);

export default async function outdated() {
  const project = await findProject();

  if (!await exists(project.manifestPath)) {
    throw new Error(
      "drenv: no mygame/drenv.toml — add a dependency with `drenv add <source>`",
    );
  }

  const manifest = await readManifest(project.manifestPath);
  const lock = await readLock(project.lockPath);

  if (!lock) {
    throw new Error("drenv: no lockfile — run `drenv bundle` first");
  }

  const stale: { name: string; from: string; to: string }[] = [];

  for (const spec of manifest.dependencies) {
    // path/url sources aren't revision-tracked, so there's nothing to compare.
    if (sourceKind(spec) === "path" || sourceKind(spec) === "url") continue;

    const locked = lock.dependencies.find((dep) => dep.name === spec.name);
    const current = await remoteRef(spec);

    if (locked?.ref && current && current !== locked.ref) {
      stale.push({ name: spec.name, from: locked.ref, to: current });
    }
  }

  if (stale.length === 0) {
    return "drenv: all dependencies up to date";
  }

  const nameWidth = Math.max(...stale.map((row) => row.name.length));
  for (const row of stale) {
    console.log(
      `  ${row.name.padEnd(nameWidth)}  ${shortRef(row.from)} → ${
        shortRef(row.to)
      }`,
    );
  }
  console.log("\nRun `drenv update [name]` to upgrade.");
}
