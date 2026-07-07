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
): Promise<{ root: string; entrypoint: string; include: string[] }> => {
  // A library declares its asset paths in `[package].include`, regardless of how
  // the entrypoint itself resolves.
  const pkg = await readPackage(staging);
  const include = pkg?.include ?? [];

  if (override) return { root: ".", entrypoint: override, include };

  if (pkg?.entrypoint) {
    return { root: pkg.root ?? ".", entrypoint: pkg.entrypoint, include };
  }

  if (await exists(join(staging, "lib", `${name}.rb`))) {
    return { root: "lib", entrypoint: `${name}.rb`, include };
  }
  if (await exists(join(staging, `${name}.rb`))) {
    return { root: ".", entrypoint: `${name}.rb`, include };
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
  const { root, entrypoint, include } = await resolveEntrypoint(
    staging,
    name,
    override,
  );

  const source = root === "." ? staging : join(staging, root);
  if (!await exists(source)) {
    throw new Error(
      `drenv: package root '${root}' not found in dependency '${name}'`,
    );
  }

  const dest = vendorDir(ctx, name);
  await Deno.remove(dest, { recursive: true }).catch(() => {});
  await copyTree(source, dest);

  // Vendor any declared asset paths (repo-root-relative) alongside the code, so
  // libraries can ship sprites/sounds/data that live outside `root`.
  for (const rel of include) {
    if (rel.startsWith("/") || rel.split(/[\\/]/).includes("..")) {
      throw new Error(
        `drenv: invalid include path '${rel}' in dependency '${name}' (must be relative, no '..')`,
      );
    }

    const from = join(staging, rel);
    if (!await exists(from)) {
      throw new Error(
        `drenv: include path '${rel}' not found in dependency '${name}'`,
      );
    }
    await copyTree(from, join(dest, rel));
  }

  if (!await exists(join(dest, entrypoint))) {
    throw new Error(
      `drenv: entrypoint '${entrypoint}' not found in dependency '${name}'`,
    );
  }

  return vendorRequire(name, entrypoint);
};
