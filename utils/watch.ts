import { exists } from "@std/fs";
import { dirname, resolve, SEPARATOR } from "@std/path";

import { readManifest, sourceKind } from "./manifest.ts";
import { type VendorContext, vendorDependency } from "./sources/mod.ts";
import type { Project } from "./project.ts";

const DEBOUNCE_MS = 150;

const ignored = (path: string): boolean =>
  path.endsWith(".DS_Store") || path.includes(`${SEPARATOR}.git${SEPARATOR}`);

/**
 * Watches the source directory of every `path:` dependency and re-vendors it
 * when its files change, so DragonRuby's hot reload picks up edits to a local
 * library while the game runs. Remote deps are pinned, so they're never
 * watched. Runs until `signal` is aborted (when the game exits).
 */
export const watchPathDeps = async (
  project: Project,
  signal: AbortSignal,
  log: (message: string) => void,
): Promise<void> => {
  const manifest = await readManifest(project.manifestPath);
  const manifestDir = dirname(project.manifestPath);

  const targets: { name: string; dir: string }[] = [];
  for (const dep of manifest.dependencies) {
    if (sourceKind(dep) !== "path") continue;
    const dir = resolve(manifestDir, dep.path!);
    if (!await exists(dir)) continue;
    // Canonicalize so prefix checks match the paths fs events report — macOS
    // reports /private/var/… for a /var/… symlink, for example.
    targets.push({ name: dep.name, dir: await Deno.realPath(dir) });
  }
  if (targets.length === 0) return;

  // Re-vendor quietly; we print our own concise "re-synced" lines instead.
  const ctx: VendorContext = {
    mygame: project.mygame,
    manifestDir,
    log: () => {},
  };
  const specs = new Map(manifest.dependencies.map((dep) => [dep.name, dep]));

  const watcher = Deno.watchFs(targets.map((t) => t.dir));
  const pending = new Set<string>();
  // `ReturnType<typeof setTimeout>` rather than `number`: newer Deno types the
  // timer id as `Timeout`.
  let timer: ReturnType<typeof setTimeout> | undefined;
  let flushing: Promise<void> = Promise.resolve();

  const stop = () => {
    if (timer !== undefined) clearTimeout(timer);
    try {
      watcher.close();
    } catch {
      // already closed
    }
  };
  if (signal.aborted) return stop();
  signal.addEventListener("abort", stop, { once: true });

  const flush = async () => {
    for (const name of [...pending]) {
      pending.delete(name);
      const spec = specs.get(name);
      if (!spec) continue;
      try {
        await vendorDependency(spec, ctx);
        log(`drenv: re-synced ${name}`);
      } catch (error) {
        log(`drenv: failed to re-sync ${name} — ${(error as Error).message}`);
      }
    }
  };

  log(
    `drenv: watching ${targets.length} path ${
      targets.length === 1 ? "dependency" : "dependencies"
    } for changes`,
  );

  try {
    for await (const event of watcher) {
      if (event.kind === "access") continue;

      for (const target of targets) {
        const touched = event.paths.some((path) =>
          !ignored(path) &&
          (path === target.dir || path.startsWith(target.dir + SEPARATOR))
        );
        if (touched) pending.add(target.name);
      }

      if (pending.size > 0) {
        if (timer !== undefined) clearTimeout(timer);
        timer = setTimeout(() => {
          flushing = flushing.then(flush);
        }, DEBOUNCE_MS);
      }
    }
  } catch {
    // watcher closed on shutdown — nothing more to do
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    await flushing;
  }
};
