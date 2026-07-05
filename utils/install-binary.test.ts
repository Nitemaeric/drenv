import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { join } from "@std/path";

import { installBinary, installBinaryWindows } from "./install-binary.ts";

const streamFrom = (text: string) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });

describe("installBinaryWindows", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await Deno.makeTempDir({ prefix: "drenv-install-bin-" });
  });

  afterEach(async () => {
    await Deno.remove(tmp, { recursive: true });
  });

  it("installs into a new destination", async () => {
    const dest = join(tmp, "drenv.exe");

    await installBinaryWindows(streamFrom("new"), dest);

    assertEquals(await Deno.readTextFile(dest), "new");
  });

  it("replaces an existing file without writing to it in place", async () => {
    const dest = join(tmp, "drenv.exe");
    await Deno.writeTextFile(dest, "old");

    await installBinaryWindows(streamFrom("new"), dest);

    assertEquals(await Deno.readTextFile(dest), "new");
  });
});

describe("installBinary", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await Deno.makeTempDir({ prefix: "drenv-install-bin-" });
  });

  afterEach(async () => {
    await Deno.remove(tmp, { recursive: true });
  });

  it("installs a binary on the current platform", async () => {
    const dest = join(
      tmp,
      Deno.build.os === "windows" ? "drenv.exe" : "drenv",
    );

    await installBinary(streamFrom("payload"), dest);

    assertEquals(await Deno.readTextFile(dest), "payload");
    if (Deno.build.os !== "windows") {
      const mode = (await Deno.stat(dest)).mode!;
      assertEquals(mode & 0o111, 0o111);
    }
  });

  it("replaces an existing file without writing to it in place", async () => {
    const dest = join(
      tmp,
      Deno.build.os === "windows" ? "drenv.exe" : "drenv",
    );
    await Deno.writeTextFile(dest, "old");

    await installBinary(streamFrom("new"), dest);

    assertEquals(await Deno.readTextFile(dest), "new");
  });
});
