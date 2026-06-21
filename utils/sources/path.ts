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
  // directory, so path deps are copied fresh (by stageIntoVendor) on every sync.
  const require = await stageIntoVendor(
    source,
    ctx,
    spec.name,
    spec.entrypoint,
  );

  ctx.log(`drenv: vendored ${spec.name} (path:${spec.path})`);

  return {
    name: spec.name,
    source: `path:${spec.path}`,
    require: [require],
  };
};
