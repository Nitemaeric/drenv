import type { DependencySpec } from "../manifest.ts";
import type { LockedDependency } from "../lockfile.ts";
import { treeDigest } from "../integrity.ts";
import { stageIntoVendor, type VendorContext, vendorDir } from "./resolve.ts";

const git = async (
  args: string[],
): Promise<{ ok: boolean; stdout: string }> => {
  let output: Deno.CommandOutput;

  try {
    output = await new Deno.Command("git", {
      args,
      stdout: "piped",
      stderr: "piped",
    }).output();
  } catch {
    throw new Error(
      "drenv: git is required for git dependencies but was not found on PATH",
    );
  }

  return {
    ok: output.success,
    stdout: new TextDecoder().decode(output.stdout).trim(),
  };
};

/**
 * The current upstream commit for a git dependency's tracked ref via
 * `git ls-remote`. Returns null for pinned commits (not listed as a ref) or
 * when the remote can't be reached.
 */
export const gitRef = async (
  spec: DependencySpec,
): Promise<string | null> => {
  const named = spec.ref ?? spec.tag ?? spec.branch ?? "HEAD";
  const { ok, stdout } = await git(["ls-remote", spec.git!, named]);
  if (!ok || !stdout) return null;

  // Each line is "<sha>\t<ref>"; take the first match's sha.
  return stdout.split("\n")[0]?.split("\t")[0] || null;
};

export const vendorGit = async (
  spec: DependencySpec,
  ctx: VendorContext,
): Promise<LockedDependency> => {
  const url = spec.git!;
  const named = spec.tag ?? spec.branch;

  const tmp = await Deno.makeTempDir({ prefix: "drenv-git-" });

  try {
    if (named) {
      const { ok } = await git([
        "clone",
        "--depth",
        "1",
        "--branch",
        named,
        url,
        tmp,
      ]);
      if (!ok) {
        throw new Error(
          `drenv: failed to clone '${spec.name}' from ${url} (ref ${named})`,
        );
      }
    } else if (spec.ref) {
      // Arbitrary commits aren't fetchable with --depth 1, so clone in full.
      const { ok } = await git(["clone", url, tmp]);
      if (!ok) {
        throw new Error(`drenv: failed to clone '${spec.name}' from ${url}`);
      }
      const { ok: checkedOut } = await git(["-C", tmp, "checkout", spec.ref]);
      if (!checkedOut) {
        throw new Error(
          `drenv: failed to checkout '${spec.ref}' for '${spec.name}'`,
        );
      }
    } else {
      const { ok } = await git(["clone", "--depth", "1", url, tmp]);
      if (!ok) {
        throw new Error(`drenv: failed to clone '${spec.name}' from ${url}`);
      }
    }

    const { stdout: sha } = await git(["-C", tmp, "rev-parse", "HEAD"]);

    const require = await stageIntoVendor(tmp, ctx, spec.name, spec.entrypoint);

    ctx.log(`drenv: vendored ${spec.name} (git:${url})`);

    return {
      name: spec.name,
      source: `git:${url}`,
      ref: sha || undefined,
      require: [require],
      integrity: await treeDigest(vendorDir(ctx, spec.name)),
    };
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }
};
