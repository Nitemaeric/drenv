import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertRejects, assertStringIncludes } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";

import build from "./build.ts";

describe("build", () => {
  let cwd: string;
  let tmp: string;
  let root: string;

  beforeEach(async () => {
    cwd = Deno.cwd();
    tmp = await Deno.makeTempDir({ prefix: "drenv-build-" });
    root = join(tmp, "game");
    await ensureDir(join(root, "mygame", "app"));
    Deno.chdir(root);
  });

  afterEach(async () => {
    Deno.chdir(cwd);
    await Deno.remove(tmp, { recursive: true });
  });

  it("rejects when dragonruby-publish is missing", async () => {
    await assertRejects(
      () => build(),
      Error,
      "dragonruby-publish binary not found",
    );
  });

  it("runs dragonruby-publish with --only-package and the game dir", async () => {
    if (Deno.build.os === "windows") return; // uses a unix shell shim

    const binary = join(root, "dragonruby-publish");
    await Deno.writeTextFile(binary, '#!/bin/sh\necho "$@" > args.txt\n');
    await Deno.chmod(binary, 0o755);

    await build(["--verbose"]);

    const args = await Deno.readTextFile(join(root, "args.txt"));
    assertStringIncludes(args, "--only-package");
    assertStringIncludes(args, "--verbose");
    assertStringIncludes(args, "mygame");
  });
});
