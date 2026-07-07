import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertRejects } from "@std/assert";
import { ensureDir, exists } from "@std/fs";
import { join } from "@std/path";

import { resolveEntrypoint, stageIntoVendor } from "./resolve.ts";

describe("resolveEntrypoint", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await Deno.makeTempDir({ prefix: "drenv-resolve-" });
  });

  afterEach(async () => {
    await Deno.remove(tmp, { recursive: true });
  });

  it("uses an explicit override, rooted at the fetched tree", async () => {
    assertEquals(
      await resolveEntrypoint(tmp, "conjuration", "lib/conjuration.rb"),
      { root: ".", entrypoint: "lib/conjuration.rb", include: [] },
    );
  });

  it("reads the library's [package] declaration", async () => {
    await Deno.writeTextFile(
      join(tmp, "drenv.toml"),
      '[package]\nroot = "lib"\nentrypoint = "conjuration.rb"\n',
    );

    assertEquals(await resolveEntrypoint(tmp, "conjuration"), {
      root: "lib",
      entrypoint: "conjuration.rb",
      include: [],
    });
  });

  it("defaults the [package] root to '.'", async () => {
    await Deno.writeTextFile(
      join(tmp, "drenv.toml"),
      '[package]\nentrypoint = "main.rb"\n',
    );

    assertEquals(await resolveEntrypoint(tmp, "x"), {
      root: ".",
      entrypoint: "main.rb",
      include: [],
    });
  });

  it("reads [package] include paths", async () => {
    await Deno.writeTextFile(
      join(tmp, "drenv.toml"),
      '[package]\nroot = "lib"\nentrypoint = "x.rb"\ninclude = ["sprites", "data"]\n',
    );

    assertEquals(await resolveEntrypoint(tmp, "x"), {
      root: "lib",
      entrypoint: "x.rb",
      include: ["sprites", "data"],
    });
  });

  it("falls back to lib/<name>.rb by convention", async () => {
    await ensureDir(join(tmp, "lib"));
    await Deno.writeTextFile(join(tmp, "lib", "conjuration.rb"), "");

    assertEquals(await resolveEntrypoint(tmp, "conjuration"), {
      root: "lib",
      entrypoint: "conjuration.rb",
      include: [],
    });
  });

  it("falls back to <name>.rb at the root", async () => {
    await Deno.writeTextFile(join(tmp, "draco.rb"), "");

    assertEquals(await resolveEntrypoint(tmp, "draco"), {
      root: ".",
      entrypoint: "draco.rb",
      include: [],
    });
  });

  it("throws when nothing matches", async () => {
    await assertRejects(
      () => resolveEntrypoint(tmp, "mystery"),
      Error,
      "couldn't determine an entrypoint",
    );
  });
});

describe("stageIntoVendor", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await Deno.makeTempDir({ prefix: "drenv-stage-" });
  });

  afterEach(async () => {
    await Deno.remove(tmp, { recursive: true });
  });

  const ctx = (mygame: string) => ({
    mygame,
    manifestDir: mygame,
    log: () => {},
  });

  it("vendors declared asset paths alongside the code", async () => {
    // A library with lib/<name>.rb plus a top-level sprites/ directory.
    const staging = join(tmp, "lib-src");
    await ensureDir(join(staging, "lib"));
    await ensureDir(join(staging, "sprites", "glyphs"));
    await Deno.writeTextFile(
      join(staging, "lib", "dragon_input.rb"),
      "# lib\n",
    );
    await Deno.writeTextFile(
      join(staging, "sprites", "glyphs", "xbox_a.png"),
      "PNG",
    );
    await Deno.writeTextFile(
      join(staging, "drenv.toml"),
      '[package]\nroot = "lib"\nentrypoint = "dragon_input.rb"\ninclude = ["sprites"]\n',
    );

    const mygame = join(tmp, "game", "mygame");
    await ensureDir(mygame);

    const require = await stageIntoVendor(staging, ctx(mygame), "dragon_input");

    assertEquals(require, "vendor/dragon_input/dragon_input.rb");
    // Code is vendored (root flattened)...
    assert(
      await exists(join(mygame, "vendor", "dragon_input", "dragon_input.rb")),
    );
    // ...and so are the declared assets, preserving their path.
    assert(
      await exists(
        join(
          mygame,
          "vendor",
          "dragon_input",
          "sprites",
          "glyphs",
          "xbox_a.png",
        ),
      ),
    );
  });

  it("rejects an include path that escapes the vendor directory", async () => {
    const staging = join(tmp, "evil");
    await ensureDir(join(staging, "lib"));
    await Deno.writeTextFile(join(staging, "lib", "x.rb"), "");
    await Deno.writeTextFile(
      join(staging, "drenv.toml"),
      '[package]\nroot = "lib"\nentrypoint = "x.rb"\ninclude = ["../secrets"]\n',
    );

    const mygame = join(tmp, "game", "mygame");
    await ensureDir(mygame);

    await assertRejects(
      () => stageIntoVendor(staging, ctx(mygame), "x"),
      Error,
      "invalid include path",
    );
  });
});
