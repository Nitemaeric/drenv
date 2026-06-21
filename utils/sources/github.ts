import { ensureDir } from "@std/fs";
import { dirname, join } from "@std/path";
import { configure, ZipReaderStream } from "@zip-js/zip-js";

import type { DependencySpec } from "../manifest.ts";
import type { LockedDependency } from "../lockfile.ts";
import { treeDigest } from "../integrity.ts";
import { stageIntoVendor, type VendorContext, vendorDir } from "./resolve.ts";

configure({ useWebWorkers: false });

const resolveSha = async (
  owner: string,
  repo: string,
  ref: string,
): Promise<string | undefined> => {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/commits/${ref}`,
      { headers: { "Accept": "application/vnd.github.sha" } },
    );
    if (!response.ok) return undefined;
    return (await response.text()).trim();
  } catch {
    return undefined;
  }
};

export const vendorGithub = async (
  spec: DependencySpec,
  ctx: VendorContext,
): Promise<LockedDependency> => {
  const [owner, repo] = spec.github!.split("/");

  if (!owner || !repo) {
    throw new Error(
      `drenv: invalid github source '${spec.github}' for '${spec.name}' (expected owner/repo)`,
    );
  }

  const requested = spec.ref ?? spec.tag ?? spec.branch ?? "HEAD";
  const sha = await resolveSha(owner, repo, requested);
  const downloadRef = sha ?? requested;

  const url = `https://codeload.github.com/${owner}/${repo}/zip/${downloadRef}`;
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(
      `drenv: failed to download '${spec.name}' from ${url} (status ${response.status})`,
    );
  }

  const staging = await Deno.makeTempDir({ prefix: "drenv-gh-" });

  try {
    for await (
      const entry of response.body.pipeThrough(new ZipReaderStream())
    ) {
      if (entry.directory) continue;

      // GitHub archives nest everything under a `<repo>-<ref>/` directory.
      const inner = entry.filename.split("/").slice(1).join("/");
      if (!inner || inner.endsWith(".DS_Store")) continue;

      const target = join(staging, inner);
      await ensureDir(dirname(target));
      await entry.readable?.pipeTo((await Deno.create(target)).writable);
    }

    const require = await stageIntoVendor(
      staging,
      ctx,
      spec.name,
      spec.entrypoint,
    );

    ctx.log(
      `drenv: vendored ${spec.name} (github:${spec.github}@${downloadRef})`,
    );

    return {
      name: spec.name,
      source: `github:${spec.github}`,
      ref: sha ?? downloadRef,
      require: [require],
      integrity: await treeDigest(vendorDir(ctx, spec.name)),
    };
  } finally {
    await Deno.remove(staging, { recursive: true }).catch(() => {});
  }
};
