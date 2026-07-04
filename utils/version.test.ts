import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals, assertRejects } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";

import { dragonrubyBinary, versionCommand } from "./version.ts";

describe("dragonrubyBinary", () => {
  it("uses the platform-specific executable name", () => {
    const expected = Deno.build.os === "windows"
      ? "dragonruby.exe"
      : "dragonruby";

    assertEquals(
      dragonrubyBinary("/opt/dragonruby").endsWith(expected),
      true,
    );
  });
});

describe("versionCommand", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await Deno.makeTempDir({ prefix: "drenv-version-cmd-" });
    await ensureDir(tmp);
  });

  afterEach(async () => {
    await Deno.remove(tmp, { recursive: true });
  });

  it("reads the version from the dragonruby binary", async () => {
    // Windows needs a real PE executable; path selection is covered above.
    if (Deno.build.os === "windows") return;

    const binary = dragonrubyBinary(tmp);

    await Deno.writeTextFile(
      binary,
      '#!/bin/sh\necho 7.11',
    );
    await Deno.chmod(binary, 0o755);

    assertEquals(await versionCommand(tmp), "7.11");
  });

  it("rejects when the dragonruby binary is missing", async () => {
    await assertRejects(
      () => versionCommand(tmp),
      Error,
      "missing dragonruby executable",
    );
  });
});