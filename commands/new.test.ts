import { afterAll, beforeAll, describe, it } from "@std/testing/bdd";
import { assert, assertRejects } from "@std/assert";
import { ensureDir, exists } from "@std/fs";
import { join } from "@std/path";

import newCommand, { NotInstalled } from "./new.ts";
import { versionsPath } from "../constants.ts";

describe("new", () => {
  beforeAll(async () => {
    await ensureDir(`${versionsPath}/99.99`);
    await Deno.writeTextFile(`${versionsPath}/99.99/marker.txt`, "v99.99");
  });

  afterAll(async () => {
    await Deno.remove(`${versionsPath}/99.99`, { recursive: true });
  });

  describe("with --version", () => {
    it("creates the project from the given version", async () => {
      const tmp = await Deno.makeTempDir({ prefix: "drenv-new-" });
      const dest = join(tmp, "proj");

      await newCommand(dest, { version: "99.99" });

      assert(await exists(join(dest, "marker.txt")));
      await Deno.remove(tmp, { recursive: true });
    });

    it("rejects when the version isn't installed", async () => {
      const tmp = await Deno.makeTempDir({ prefix: "drenv-new-" });

      await assertRejects(
        () => newCommand(join(tmp, "proj"), { version: "0.0.0" }),
        NotInstalled,
        "version '0.0.0' not installed",
      );

      await Deno.remove(tmp, { recursive: true });
    });
  });
});
