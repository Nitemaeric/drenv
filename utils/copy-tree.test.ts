import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import { ensureDir, exists } from "@std/fs";
import { join } from "@std/path";

import { copyTree } from "./copy-tree.ts";

describe("copyTree", () => {
  let tmp: string;
  let src: string;
  let dest: string;

  beforeEach(async () => {
    tmp = await Deno.makeTempDir({ prefix: "drenv-copy-tree-" });
    src = join(tmp, "src");
    dest = join(tmp, "dest");
    await ensureDir(src);
  });

  afterEach(async () => {
    await Deno.remove(tmp, { recursive: true });
  });

  it("mirrors a nested tree, empty directories included", async () => {
    await ensureDir(join(src, "app"));
    await Deno.writeTextFile(join(src, "app", "main.rb"), "def tick args\nend");
    await ensureDir(join(src, "sounds"));
    await ensureDir(join(src, "sprites", "enemies"));

    await copyTree(src, dest);

    assertEquals(
      await Deno.readTextFile(join(dest, "app", "main.rb")),
      "def tick args\nend",
    );
    assert(await exists(join(dest, "sounds"), { isDirectory: true }));
    assert(
      await exists(join(dest, "sprites", "enemies"), { isDirectory: true }),
    );
  });

  it("copies a single file src, creating the dest parent", async () => {
    const file = join(src, "run");
    await Deno.writeTextFile(file, "#!/bin/sh");

    await copyTree(file, join(dest, "nested", "run"));

    assertEquals(
      await Deno.readTextFile(join(dest, "nested", "run")),
      "#!/bin/sh",
    );
  });

  it("skips .DS_Store and .git", async () => {
    await Deno.writeTextFile(join(src, ".DS_Store"), "junk");
    await ensureDir(join(src, ".git"));
    await Deno.writeTextFile(join(src, ".git", "HEAD"), "ref");
    await Deno.writeTextFile(join(src, "keep.rb"), "keep");

    await copyTree(src, dest);

    assert(await exists(join(dest, "keep.rb")));
    assert(!(await exists(join(dest, ".DS_Store"))));
    assert(!(await exists(join(dest, ".git"))));
  });

  it("merges into an existing dest: overwrites files, keeps extras", async () => {
    await Deno.writeTextFile(join(src, "docs.txt"), "new");
    await ensureDir(dest);
    await Deno.writeTextFile(join(dest, "docs.txt"), "old");
    await Deno.writeTextFile(join(dest, "mygame.rb"), "precious");

    await copyTree(src, dest);

    assertEquals(await Deno.readTextFile(join(dest, "docs.txt")), "new");
    assertEquals(await Deno.readTextFile(join(dest, "mygame.rb")), "precious");
  });

  it("preserves the executable bit", async () => {
    if (Deno.build.os === "windows") return;
    await Deno.writeTextFile(join(src, "dragonruby"), "#!/bin/sh");
    await Deno.chmod(join(src, "dragonruby"), 0o755);

    await copyTree(src, dest);

    const mode = (await Deno.stat(join(dest, "dragonruby"))).mode ?? 0;
    assert((mode & 0o111) !== 0, "executable bit lost");
  });

  it("never runs file copies concurrently (EMFILE regression)", async () => {
    for (let d = 0; d < 5; d++) {
      await ensureDir(join(src, `dir${d}`));
      for (let f = 0; f < 20; f++) {
        await Deno.writeTextFile(join(src, `dir${d}`, `f${f}.txt`), "x");
      }
    }

    const real = Deno.copyFile.bind(Deno);
    let inflight = 0;
    let peak = 0;
    Deno.copyFile = async (from: string | URL, to: string | URL) => {
      inflight++;
      peak = Math.max(peak, inflight);
      await new Promise((r) => setTimeout(r, 1));
      try {
        return await real(from, to);
      } finally {
        inflight--;
      }
    };
    try {
      await copyTree(src, dest);
    } finally {
      Deno.copyFile = real;
    }

    assertEquals(peak, 1);
    assert(await exists(join(dest, "dir4", "f19.txt")));
  });
});
