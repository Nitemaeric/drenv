import { exists } from "@std/fs";
import { join, resolve } from "@std/path";

import type { DependencySpec } from "../manifest.ts";
import type { LockedDependency } from "../lockfile.ts";
import { copyTree } from "../copy-tree.ts";
import {
  requireEntrypoint,
  type VendorContext,
  vendorDir,
  vendorRequire,
} from "./mod.ts";

export const vendorPath = async (
  spec: DependencySpec,
  ctx: VendorContext,
): Promise<LockedDependency> => {
  const entrypoint = requireEntrypoint(spec);
  const source = resolve(ctx.manifestDir, spec.path!);

  if (!await exists(source)) {
    throw new Error(
      `drenv: path dependency '${spec.name}' not found at ${source}`,
    );
  }

  const dest = vendorDir(ctx, spec.name);
  // Mirror the source. DragonRuby's sandboxed loader can't follow symlinks out
  // of the game directory, so path deps are copied fresh on every sync.
  await Deno.remove(dest, { recursive: true }).catch(() => {});
  await copyTree(source, dest);

  if (!await exists(join(dest, entrypoint))) {
    throw new Error(
      `drenv: entrypoint '${entrypoint}' not found in dependency '${spec.name}'`,
    );
  }

  ctx.log(`drenv: vendored ${spec.name} (path:${spec.path})`);

  return {
    name: spec.name,
    source: `path:${spec.path}`,
    require: [vendorRequire(spec.name, entrypoint)],
  };
};
