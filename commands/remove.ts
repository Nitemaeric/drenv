import { join } from "@std/path";

import { findProject } from "../utils/project.ts";
import { removeDependencyFromManifest } from "../utils/manifest-edit.ts";
import { fileDigest } from "../utils/integrity.ts";
import { readLock, writeLock } from "../utils/lockfile.ts";
import { writeBundleFile } from "../utils/bundle-file.ts";

export default async function remove(name: string) {
  const project = await findProject();

  // Throws if the dependency isn't present.
  await removeDependencyFromManifest(project.manifestPath, name);

  await Deno.remove(join(project.mygame, "vendor", name), { recursive: true })
    .catch(() => {});

  // Drop it from the lock and regenerate the bundle without re-fetching the
  // surviving dependencies.
  const lock = await readLock(project.lockPath);
  if (lock) {
    lock.dependencies = lock.dependencies.filter((dep) => dep.name !== name);
    lock.manifest_digest = await fileDigest(project.manifestPath);
    await writeLock(project.lockPath, lock);
    await writeBundleFile(project.mygame, lock);
  }

  console.log(`drenv: removed ${name}`);
}
