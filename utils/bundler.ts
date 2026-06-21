import { exists } from "@std/fs";
import { dirname, join } from "@std/path";

import { readManifest, sourceKind } from "./manifest.ts";
import {
  type LockedDependency,
  type Lockfile,
  LOCKFILE_VERSION,
  readLock,
  writeLock,
} from "./lockfile.ts";
import { fileDigest, treeDigest } from "./integrity.ts";
import { type VendorContext, vendorDependency } from "./sources/mod.ts";
import { writeBundleFile } from "./bundle-file.ts";
import type { Project } from "./project.ts";

export type BundleResult = {
  lock: Lockfile;
  /** True when `main.rb` does not yet require the generated bundle. */
  needsRequireLine: boolean;
};

type Options = { log?: (message: string) => void };

const context = (
  project: Project,
  log: (message: string) => void,
): VendorContext => ({
  mygame: project.mygame,
  manifestDir: dirname(project.manifestPath),
  log,
});

/** Resolves every dependency from scratch and rewrites the lock + bundle. */
export const bundle = async (
  project: Project,
  options: Options = {},
): Promise<BundleResult> => {
  const log = options.log ?? (() => {});
  const manifest = await readManifest(project.manifestPath);
  const ctx = context(project, log);

  const dependencies: LockedDependency[] = [];
  for (const spec of manifest.dependencies) {
    dependencies.push(await vendorDependency(spec, ctx));
  }

  const lock: Lockfile = {
    lockfile_version: LOCKFILE_VERSION,
    manifest_digest: await fileDigest(project.manifestPath),
    dependencies,
  };

  await writeLock(project.lockPath, lock);
  await writeBundleFile(project.mygame, lock);

  return { lock, needsRequireLine: await needsRequireLine(project) };
};

/**
 * Brings the vendor directory in line with the existing lock without a full
 * re-resolve: path deps are always re-synced (they are mutable), remote deps
 * are only re-fetched when missing or when their checksum no longer matches.
 * Falls back to a full {@link bundle} when the lock is missing or stale.
 */
export const reconcile = async (
  project: Project,
  options: Options = {},
): Promise<BundleResult> => {
  const log = options.log ?? (() => {});
  const lock = await readLock(project.lockPath);
  const digest = await fileDigest(project.manifestPath).catch(() => null);

  if (!lock || !digest || lock.manifest_digest !== digest) {
    return bundle(project, options);
  }

  const manifest = await readManifest(project.manifestPath);
  const ctx = context(project, log);

  for (const spec of manifest.dependencies) {
    const locked = lock.dependencies.find((dep) => dep.name === spec.name);
    const dir = join(project.mygame, "vendor", spec.name);

    if (sourceKind(spec) === "path" || !await matches(dir, locked?.integrity)) {
      await vendorDependency(spec, ctx);
    }
  }

  await writeBundleFile(project.mygame, lock);

  return { lock, needsRequireLine: await needsRequireLine(project) };
};

const matches = async (
  dir: string,
  integrity: string | undefined,
): Promise<boolean> => {
  if (!integrity || !await exists(dir)) return false;

  try {
    return await treeDigest(dir) === integrity;
  } catch {
    return false;
  }
};

const needsRequireLine = async (project: Project): Promise<boolean> => {
  try {
    const main = await Deno.readTextFile(
      join(project.mygame, "app", "main.rb"),
    );
    return !/require\s+['"]app\/drenv_bundle(\.rb)?['"]/.test(main);
  } catch {
    // No main.rb to inspect — surface the reminder so the user wires it up.
    return true;
  }
};
