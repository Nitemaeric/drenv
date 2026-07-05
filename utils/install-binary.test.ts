import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { join } from "@std/path";

import { installBinary } from "./install-binary.ts";

const streamFrom = (text: string) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });

const destPath = (tmp: string) =>
  join(tmp, Deno.build.os === "windows" ? "drenv.exe" : "drenv");

describe("installBinary", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await Deno.makeTempDir({ prefix: "drenv-install-bin-" });
  });

  afterEach(async () => {
    await Deno.remove(tmp, { recursive: true });
  });

  it("installs into a new destination", async () => {
    const dest = destPath(tmp);

    await installBinary(streamFrom("new"), dest);

    assertEquals(await Deno.readTextFile(dest), "new");
    if (Deno.build.os !== "windows") {
      const mode = (await Deno.stat(dest)).mode!;
      assertEquals(mode & 0o111, 0o111);
    }
  });

  it("replaces an existing file without writing to it in place", async () => {
    const dest = destPath(tmp);
    await Deno.writeTextFile(dest, "old");

    await installBinary(streamFrom("new"), dest);

    assertEquals(await Deno.readTextFile(dest), "new");
  });
});