import { ensureDir } from "@std/fs";
import { basename, dirname, join } from "@std/path";

import type { DependencySpec } from "../manifest.ts";
import { treeDigest } from "../integrity.ts";
import {
  type VendorContext,
  vendorDir,
  vendorRequire,
  type VendorResult,
} from "./resolve.ts";

export const vendorUrl = async (
  spec: DependencySpec,
  ctx: VendorContext,
): Promise<VendorResult> => {
  const url = spec.url!;
  const filename = spec.entrypoint ?? basename(new URL(url).pathname);

  if (!filename) {
    throw new Error(
      `drenv: could not determine a filename for '${spec.name}'; set an entrypoint`,
    );
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `drenv: failed to download '${spec.name}' from ${url} (status ${response.status})`,
    );
  }

  const bytes = new Uint8Array(await response.arrayBuffer());

  const dest = vendorDir(ctx, spec.name);
  await Deno.remove(dest, { recursive: true }).catch(() => {});

  const file = join(dest, filename);
  await ensureDir(dirname(file));
  await Deno.writeFile(file, bytes);

  ctx.log(`drenv: vendored ${spec.name} (url)`);

  return {
    locked: {
      name: spec.name,
      source: `url:${url}`,
      require: [vendorRequire(spec.name, filename)],
      integrity: await treeDigest(dest),
    },
    staged: true,
  };
};
