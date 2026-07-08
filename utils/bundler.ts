import { exists } from "@std/fs";
import { dirname, join, relative, resolve } from "@std/path";

import {
  type DependencySpec,
  readManifest,
  type SourceKind,
  sourceKind,
} from "./manifest.ts";
import {
  type LockedDependency,
  type Lockfile,
  LOCKFILE_VERSION,
  readLock,
  writeLock,
} from "./lockfile.ts";
import { fileDigest, treeDigest } from "./integrity.ts";
import { type VendorContext, vendorDependency } from "./sources/mod.ts";
import { ensureVendorIgnore, writeBundleFile } from "./bundle-file.ts";
import type { Project } from "./project.ts";

export type BundleResult = {
  lock: Lockfile;
  /** True when `main.rb` does not yet require the generated bundle. */
  needsRequireLine: boolean;
};

type Options = { log?: (message: string) => void; frozen?: boolean };

const context = (
  project: Project,
  log: (message: string) => void,
): VendorContext => ({
  mygame: project.mygame,
  manifestDir: dirname(project.manifestPath),
  log,
});

/**
 * A dependency's declared identity — source plus pins — used to decide whether
 * two declarations of the same name agree. Resolved refs are deliberately
 * excluded: a lock-derived spec carries the pinned sha while a manifest spec
 * carries the declared intent, and those must compare equal.
 */
const specIdentity = (spec: DependencySpec): string => {
  const kind = sourceKind(spec);
  return [
    `${kind}:${spec[kind]}`,
    spec.tag ?? "",
    spec.branch ?? "",
    spec.entrypoint ?? "",
  ].join("|");
};

const lockedIdentity = (locked: LockedDependency): string =>
  [
    locked.source,
    locked.tag ?? "",
    locked.branch ?? "",
    locked.entrypoint ?? "",
  ].join("|");

/** Reconstructs a resolvable spec from a lock entry (exact ref for remotes). */
export const lockedToSpec = (locked: LockedDependency): DependencySpec => {
  const idx = locked.source.indexOf(":");
  const kind = locked.source.slice(0, idx) as SourceKind;
  const spec: DependencySpec = {
    name: locked.name,
    entrypoint: locked.entrypoint,
  };
  spec[kind] = locked.source.slice(idx + 1);

  if (kind === "github" || kind === "git") {
    spec.ref = locked.ref;
  }

  return spec;
};

/** Like lockedToSpec, but with the declared pin (tag/branch) instead of the
 * resolved ref — the spec to use when *updating* the dependency. */
export const lockedToDeclaredSpec = (
  locked: LockedDependency,
): DependencySpec => {
  const spec = lockedToSpec(locked);
  delete spec.ref;
  spec.tag = locked.tag;
  spec.branch = locked.branch;
  return spec;
};

type Node = {
  spec: DependencySpec;
  topLevel: boolean;
  via: Set<string>;
  children: string[];
  locked?: LockedDependency;
  sourceDir?: string;
};

type GraphOptions = {
  ctx: VendorContext;
  lock: Lockfile | null;
  /** Whether a locked entry should be re-fetched instead of reused. `spec` is
   * the declaration the graph is currently resolving for this name. */
  refetch: (
    name: string,
    locked: LockedDependency,
    spec: DependencySpec,
  ) => boolean;
};

/**
 * Resolves the full dependency graph — the game's declared dependencies plus
 * everything they declare in their own `[dependencies]` — into topologically
 * ordered lock entries (dependencies before their dependents).
 *
 * Dedupe is flat: one vendored copy per name. When the same name is declared
 * twice, the game's top-level declaration wins (with a warning on mismatch);
 * two disagreeing transitive declarations are an error, resolved by declaring
 * the package top-level.
 */
const resolveGraph = async (
  manifestDeps: DependencySpec[],
  { ctx, lock, refetch }: GraphOptions,
): Promise<LockedDependency[]> => {
  const nodes = new Map<string, Node>();
  const queue: string[] = [];

  for (const spec of manifestDeps) {
    nodes.set(spec.name, {
      spec,
      topLevel: true,
      via: new Set(),
      children: [],
    });
    queue.push(spec.name);
  }

  const register = (spec: DependencySpec, parent: Node) => {
    if (!parent.children.includes(spec.name)) {
      parent.children.push(spec.name);
    }

    const existing = nodes.get(spec.name);
    if (!existing) {
      nodes.set(spec.name, {
        spec,
        topLevel: false,
        via: new Set([parent.spec.name]),
        children: [],
      });
      queue.push(spec.name);
      return;
    }

    if (existing.topLevel) {
      if (specIdentity(existing.spec) !== specIdentity(spec)) {
        ctx.log(
          `drenv: '${parent.spec.name}' wants ${spec.name} (${
            specIdentity(spec).split("|")[0]
          }) but your drenv.toml declares it — using your spec`,
        );
      }
      return;
    }

    if (specIdentity(existing.spec) !== specIdentity(spec)) {
      const [other] = existing.via;
      throw new Error(
        `drenv: '${other}' and '${parent.spec.name}' declare conflicting specs for '${spec.name}' — declare it in mygame/drenv.toml to pick one`,
      );
    }

    existing.via.add(parent.spec.name);
  };

  /** Rewrites a library-declared child spec into game-relative terms. */
  const normalizeChild = (
    child: DependencySpec,
    parent: Node,
  ): DependencySpec => {
    if (sourceKind(child) !== "path") return child;

    // A relative path in a remote library points at nothing on this machine.
    if (!parent.sourceDir) {
      throw new Error(
        `drenv: '${parent.spec.name}' declares path dependency '${child.name}' — path dependencies can't be transitive from remote sources`,
      );
    }

    const absolute = resolve(parent.sourceDir, child.path!);
    return {
      ...child,
      path: (relative(ctx.manifestDir, absolute) || ".").replaceAll("\\", "/"),
    };
  };

  while (queue.length > 0) {
    const name = queue.shift()!;
    const node = nodes.get(name)!;
    const locked = lock?.dependencies.find((dep) => dep.name === name);

    if (locked && !refetch(name, locked, node.spec)) {
      node.locked = locked;

      // Reused entries re-derive their children from the lock graph.
      for (const child of lock!.dependencies) {
        if (child.via?.includes(name)) {
          register(lockedToDeclaredSpec(child), node);
        }
      }
      continue;
    }

    const result = await vendorDependency(node.spec, ctx);
    node.locked = result.locked;
    node.sourceDir = result.sourceDir;

    for (const child of result.dependencies) {
      register(normalizeChild(child, node), node);
    }
  }

  // Post-order DFS from the top-level roots: children (dependencies) are
  // emitted before their parents, so the bundle file requires them in order.
  const ordered: LockedDependency[] = [];
  const state = new Map<string, "visiting" | "done">();

  const visit = (name: string, chain: string[]) => {
    const status = state.get(name);
    if (status === "done") return;
    if (status === "visiting") {
      throw new Error(
        `drenv: dependency cycle: ${[...chain, name].join(" -> ")}`,
      );
    }

    state.set(name, "visiting");
    const node = nodes.get(name)!;
    for (const child of node.children) {
      visit(child, [...chain, name]);
    }
    state.set(name, "done");

    ordered.push({
      ...node.locked!,
      via: node.topLevel ? undefined : [...node.via].sort(),
    });
  };

  for (const spec of manifestDeps) {
    visit(spec.name, []);
  }

  return ordered;
};

/** Removes vendor directories of packages that fell out of the graph. */
const removeOrphans = async (
  project: Project,
  oldLock: Lockfile | null,
  dependencies: LockedDependency[],
): Promise<void> => {
  if (!oldLock) return;

  const live = new Set(dependencies.map((dep) => dep.name));
  for (const dep of oldLock.dependencies) {
    if (!live.has(dep.name)) {
      await Deno.remove(join(project.mygame, "vendor", dep.name), {
        recursive: true,
      }).catch(() => {});
    }
  }
};

const finalize = async (
  project: Project,
  dependencies: LockedDependency[],
  oldLock: Lockfile | null,
): Promise<BundleResult> => {
  await removeOrphans(project, oldLock, dependencies);

  const lock: Lockfile = {
    lockfile_version: LOCKFILE_VERSION,
    manifest_digest: await fileDigest(project.manifestPath),
    dependencies,
  };

  await writeLock(project.lockPath, lock);
  await writeBundleFile(project.mygame, lock);
  await ensureVendorIgnore(project.mygame);

  return { lock, needsRequireLine: await needsRequireLine(project) };
};

/** Resolves every dependency from scratch and rewrites the lock + bundle. */
export const bundle = async (
  project: Project,
  options: Options = {},
): Promise<BundleResult> => {
  const log = options.log ?? (() => {});
  const manifest = await readManifest(project.manifestPath);
  const ctx = context(project, log);
  const oldLock = await readLock(project.lockPath);

  const dependencies = await resolveGraph(manifest.dependencies, {
    ctx,
    lock: oldLock,
    refetch: () => true,
  });

  return finalize(project, dependencies, oldLock);
};

/**
 * Brings the vendor directory in line with the existing lock without a full
 * re-resolve: path deps are always re-synced (they are mutable), remote deps
 * are only re-fetched when missing or when their checksum no longer matches.
 * Transitive dependencies are restored from their lock entries. Falls back to
 * a full {@link bundle} when the lock is missing or stale.
 *
 * With `frozen`, the lock is treated as authoritative: a missing/stale lock or
 * a remote dependency whose fetched contents don't match the recorded checksum
 * is an error rather than a re-resolve. Path deps are still synced from their
 * (in-repo) source. Use it for reproducible CI installs.
 */
export const reconcile = async (
  project: Project,
  options: Options = {},
): Promise<BundleResult> => {
  const log = options.log ?? (() => {});
  const frozen = options.frozen ?? false;
  const lock = await readLock(project.lockPath);
  const digest = await fileDigest(project.manifestPath).catch(() => null);

  if (!lock || !digest || lock.manifest_digest !== digest) {
    if (frozen) {
      throw new Error(
        "drenv: the lockfile is missing or out of date — run `drenv bundle`",
      );
    }
    return bundle(project, options);
  }

  const manifest = await readManifest(project.manifestPath);
  const ctx = context(project, log);

  for (const locked of lock.dependencies) {
    // Top-level entries use the manifest's spec; transitive entries are
    // reconstructed from the lock (pinned to their exact resolved ref).
    const spec = manifest.dependencies.find((d) => d.name === locked.name) ??
      lockedToSpec(locked);
    const dir = join(project.mygame, "vendor", locked.name);

    if (sourceKind(spec) === "path") {
      await vendorDependency(spec, ctx);
    } else if (!await matches(dir, locked.integrity)) {
      await vendorDependency(spec, ctx);

      if (frozen && !await matches(dir, locked.integrity)) {
        throw new Error(
          `drenv: dependency '${locked.name}' does not match the lockfile — run \`drenv bundle\``,
        );
      }
    }
  }

  await writeBundleFile(project.mygame, lock);
  await ensureVendorIgnore(project.mygame);

  return { lock, needsRequireLine: await needsRequireLine(project) };
};

/**
 * Re-resolves a single dependency to its latest, keeping every other
 * dependency at its currently locked revision. The target may be transitive —
 * the graph walk reaches it through its (reused) parents and re-resolves it at
 * its declared pin. Anything not yet locked — a new dependency, or one the
 * updated package newly declares — is resolved too, and packages that fell out
 * of the graph are dropped.
 */
export const updateDependency = async (
  project: Project,
  name: string,
  options: Options = {},
): Promise<BundleResult> => {
  const log = options.log ?? (() => {});
  const manifest = await readManifest(project.manifestPath);
  const oldLock = await readLock(project.lockPath);

  const known = manifest.dependencies.some((dep) => dep.name === name) ||
    oldLock?.dependencies.some(
      (dep) => dep.name === name && dep.via?.length,
    );

  if (!known) {
    throw new Error(
      `drenv: no dependency named '${name}' in ${project.manifestPath}`,
    );
  }

  const ctx = context(project, log);

  const dependencies = await resolveGraph(manifest.dependencies, {
    ctx,
    lock: oldLock,
    // Re-fetch the target, plus any entry whose declared spec no longer
    // matches what was locked (e.g. a parent update changed a child's pin).
    refetch: (depName, locked, spec) =>
      depName === name || specIdentity(spec) !== lockedIdentity(locked),
  });

  return finalize(project, dependencies, oldLock);
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
