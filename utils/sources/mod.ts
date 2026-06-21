import { type DependencySpec, sourceKind } from "../manifest.ts";
import type { LockedDependency } from "../lockfile.ts";

import { vendorGit } from "./git.ts";
import { vendorGithub } from "./github.ts";
import { vendorPath } from "./path.ts";
import { vendorUrl } from "./url.ts";

export type { VendorContext } from "./resolve.ts";
import type { VendorContext } from "./resolve.ts";

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
