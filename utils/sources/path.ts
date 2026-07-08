import { exists } from "@std/fs";
import { resolve } from "@std/path";

import type { DependencySpec } from "../manifest.ts";
import type { LockedDependency } from "../lockfile.ts";
import { stageIntoVendor, type VendorContext } from "./resolve.ts";

export const vendorPath = async (
  spec: DependencySpec,
  ctx: VendorContext,
): Promise<LockedDependency> => {
  const source = resolve(ctx.manifestDir, spec.path!);

  if (!await exists(source)) {
    throw new Error(
      `drenv: path dependency '${spec.name}' not found at ${source}`,
    );
  }

  // DragonRuby's sandboxed loader can't follow symlinks out of the game
  // directory, so path deps are copied (by stageIntoVendor) rather than linked.
  // `cache` skips the copy when the vendored tree already matches the source, so
  // an unchanged local library doesn't churn every file's mtime on each sync.
  const { require, staged } = await stageIntoVendor(
    source,
    ctx,
    spec.name,
    spec.entrypoint,
    { cache: true },
  );

  if (staged) ctx.log(`drenv: vendored ${spec.name} (path:${spec.path})`);

  return {
    name: spec.name,
    source: `path:${spec.path}`,
    require: [require],
  };
};
