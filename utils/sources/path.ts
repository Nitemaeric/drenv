import { exists } from "@std/fs";
import { resolve } from "@std/path";

import type { DependencySpec } from "../manifest.ts";
import {
  readLibraryDependencies,
  stageIntoVendor,
  type VendorContext,
  type VendorResult,
} from "./resolve.ts";

export const vendorPath = async (
  spec: DependencySpec,
  ctx: VendorContext,
): Promise<VendorResult> => {
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
    locked: {
      name: spec.name,
      source: `path:${spec.path}`,
      require: [require],
      entrypoint: spec.entrypoint,
    },
    staged,
    dependencies: await readLibraryDependencies(source),
    sourceDir: source,
  };
};
