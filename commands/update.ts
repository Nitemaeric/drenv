import { exists } from "@std/fs";

import { findProject } from "../utils/project.ts";
import { bundle, updateDependency } from "../utils/bundler.ts";
import { type Lockfile, readLock } from "../utils/lockfile.ts";

const shortRef = (ref: string | undefined): string =>
  ref ? ref.slice(0, 7) : "local";

/** Lines describing what changed between two locks, newest resolution wins. */
const diff = (before: Lockfile | null, after: Lockfile): string[] => {
  const changes: string[] = [];

  for (const dep of after.dependencies) {
    const prev = before?.dependencies.find((d) => d.name === dep.name);

    if (!prev) {
      changes.push(`  ${dep.name}  added (${shortRef(dep.ref)})`);
    } else if (prev.ref !== dep.ref) {
      changes.push(
        `  ${dep.name}  ${shortRef(prev.ref)} → ${shortRef(dep.ref)}`,
      );
    }
  }

  return changes;
};

export default async function update(name?: string) {
  const project = await findProject();

  if (!await exists(project.manifestPath)) {
    throw new Error(
      "drenv: no mygame/drenv.toml — add a dependency with `drenv add <source>`",
    );
  }

  const before = await readLock(project.lockPath);
  const log = (message: string) => console.log(message);

  // Updating one dependency needs a baseline lock to preserve the others;
  // without it (or without a name), fall back to a full re-resolve.
  const { lock: after } = name && before
    ? await updateDependency(project, name, { log })
    : await bundle(project, { log });

  const changes = diff(before, after);

  if (changes.length === 0) {
    return "drenv: already up to date";
  }

  console.log("drenv: updated");
  for (const change of changes) console.log(change);
}
