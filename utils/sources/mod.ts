import { join } from "@std/path";

import {
  type DependencySpec,
  InvalidManifest,
  sourceKind,
} from "../manifest.ts";
import type { LockedDependency } from "../lockfile.ts";

import { vendorGit } from "./git.ts";
import { vendorGithub } from "./github.ts";
import { vendorPath } from "./path.ts";
import { vendorUrl } from "./url.ts";

export type VendorContext = {
  /** Absolute path to the project's `mygame` directory. */
  mygame: string;
  /** Absolute directory the manifest lives in (resolves `path:` specs). */
  manifestDir: string;
  /** Progress logger. */
  log: (message: string) => void;
};

/** Absolute path of a dependency's vendor directory. */
export const vendorDir = (ctx: VendorContext, name: string): string =>
  join(ctx.mygame, "vendor", name);

/** A require path (relative to `mygame`) into a dependency's vendor directory. */
export const vendorRequire = (name: string, entrypoint: string): string =>
  `vendor/${name}/${entrypoint}`;

/** Asserts a dependency declares an entrypoint and returns it. */
export const requireEntrypoint = (spec: DependencySpec): string => {
  if (!spec.entrypoint) {
    throw new InvalidManifest(
      `dependency '${spec.name}' must declare an entrypoint`,
    );
  }

  return spec.entrypoint;
};

export const vendorDependency = (
  spec: DependencySpec,
  ctx: VendorContext,
): Promise<LockedDependency> => {
  switch (sourceKind(spec)) {
    case "path":
      return vendorPath(spec, ctx);
    case "url":
      return vendorUrl(spec, ctx);
    case "github":
      return vendorGithub(spec, ctx);
    case "git":
      return vendorGit(spec, ctx);
  }
};
