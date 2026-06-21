import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals, assertRejects } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";

import { resolveEntrypoint } from "./resolve.ts";

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
      { root: ".", entrypoint: "lib/conjuration.rb" },
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
    });
  });

  it("falls back to lib/<name>.rb by convention", async () => {
    await ensureDir(join(tmp, "lib"));
    await Deno.writeTextFile(join(tmp, "lib", "conjuration.rb"), "");

    assertEquals(await resolveEntrypoint(tmp, "conjuration"), {
      root: "lib",
      entrypoint: "conjuration.rb",
    });
  });

  it("falls back to <name>.rb at the root", async () => {
    await Deno.writeTextFile(join(tmp, "draco.rb"), "");

    assertEquals(await resolveEntrypoint(tmp, "draco"), {
      root: ".",
      entrypoint: "draco.rb",
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
