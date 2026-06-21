import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals, assertNotEquals } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";

import { treeDigest } from "./integrity.ts";

describe("treeDigest", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await Deno.makeTempDir({ prefix: "drenv-int-" });
  });

  afterEach(async () => {
    await Deno.remove(tmp, { recursive: true });
  });

  const seed = async (dir: string) => {
    await ensureDir(join(dir, "sub"));
    await Deno.writeTextFile(join(dir, "a.rb"), "A");
    await Deno.writeTextFile(join(dir, "sub", "b.rb"), "B");
  };

  it("is identical for identical trees", async () => {
    const one = join(tmp, "one");
    const two = join(tmp, "two");
    await seed(one);
    await seed(two);

    assertEquals(await treeDigest(one), await treeDigest(two));
  });

  it("changes when a file's contents change", async () => {
    const dir = join(tmp, "dir");
    await seed(dir);
    const before = await treeDigest(dir);

    await Deno.writeTextFile(join(dir, "a.rb"), "changed");

    assertNotEquals(await treeDigest(dir), before);
  });

  it("ignores .DS_Store noise", async () => {
    const dir = join(tmp, "dir");
    await seed(dir);
    const before = await treeDigest(dir);

    await Deno.writeTextFile(join(dir, ".DS_Store"), "junk");

    assertEquals(await treeDigest(dir), before);
  });
});
