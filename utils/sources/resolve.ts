import { exists } from "@std/fs";
import { join } from "@std/path";
import { parse } from "@std/toml";

import type { PackageSpec } from "../manifest.ts";
import { copyTree } from "../copy-tree.ts";

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

/** Reads just the `[package]` table from a library's `drenv.toml`, if any. */
const readPackage = async (dir: string): Promise<PackageSpec | undefined> => {
  try {
    const data = parse(await Deno.readTextFile(join(dir, "drenv.toml"))) as {
      package?: PackageSpec;
    };
    return data.package;
  } catch {
    return undefined;
  }
};

/**
 * Determines which directory of a fetched library is the package root and which
 * file is its entrypoint:
 *
 *   1. an explicit override (consumer `-e` / manifest entrypoint), taken
 *      relative to the fetched root;
 *   2. the library's own `[package]` declaration (root + entrypoint);
 *   3. convention — `lib/<name>.rb` (vendoring just `lib/`), then `<name>.rb`.
 */
export const resolveEntrypoint = async (
  staging: string,
  name: string,
  override?: string,
): Promise<{ root: string; entrypoint: string }> => {
  if (override) return { root: ".", entrypoint: override };

  const pkg = await readPackage(staging);
  if (pkg?.entrypoint) {
    return { root: pkg.root ?? ".", entrypoint: pkg.entrypoint };
  }

  if (await exists(join(staging, "lib", `${name}.rb`))) {
    return { root: "lib", entrypoint: `${name}.rb` };
  }
  if (await exists(join(staging, `${name}.rb`))) {
    return { root: ".", entrypoint: `${name}.rb` };
  }

  throw new Error(
    `drenv: couldn't determine an entrypoint for '${name}' — the library declares no [package] entrypoint and neither lib/${name}.rb nor ${name}.rb exists; pass -e <file>`,
  );
};

/**
 * Mirrors a fetched library's package root into its vendor directory and
 * returns the require path. `staging` is the fetched tree — a temp checkout for
 * remote sources, or the source directory itself for path deps.
 */
export const stageIntoVendor = async (
  staging: string,
  ctx: VendorContext,
  name: string,
  override?: string,
): Promise<string> => {
  const { root, entrypoint } = await resolveEntrypoint(staging, name, override);

  const source = root === "." ? staging : join(staging, root);
  if (!await exists(source)) {
    throw new Error(
      `drenv: package root '${root}' not found in dependency '${name}'`,
    );
  }

  const dest = vendorDir(ctx, name);
  await Deno.remove(dest, { recursive: true }).catch(() => {});
  await copyTree(source, dest);

  if (!await exists(join(dest, entrypoint))) {
    throw new Error(
      `drenv: entrypoint '${entrypoint}' not found in dependency '${name}'`,
    );
  }

  return vendorRequire(name, entrypoint);
};
