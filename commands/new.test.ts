import { afterAll, beforeAll, describe, it } from "@std/testing/bdd";
import { assert, assertRejects, assertStringIncludes } from "@std/assert";
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

  describe("without a version", () => {
    it("defaults to the latest installed version", async () => {
      // 99.99 is the highest fixture, so it's the latest installed.
      const tmp = await Deno.makeTempDir({ prefix: "drenv-new-" });
      const dest = join(tmp, "proj");

      const message = await newCommand(dest);

      assert(await exists(join(dest, "marker.txt")));
      assertStringIncludes(message ?? "", "Created");
      assertStringIncludes(message ?? "", "99.99");
      await Deno.remove(tmp, { recursive: true });
    });
  });

  describe(".gitignore", () => {
    it("generates a project .gitignore by default", async () => {
      const tmp = await Deno.makeTempDir({ prefix: "drenv-new-" });
      const dest = join(tmp, "proj");

      await newCommand(dest, { version: "99.99" });

      const gitignore = await Deno.readTextFile(join(dest, ".gitignore"));
      assertStringIncludes(gitignore, "dragonruby");
      assertStringIncludes(gitignore, "tmp/");

      await Deno.remove(tmp, { recursive: true });
    });

    it("skips it with --skip-gitignore", async () => {
      const tmp = await Deno.makeTempDir({ prefix: "drenv-new-" });
      const dest = join(tmp, "proj");

      await newCommand(dest, { version: "99.99", skipGitignore: true });

      assert(!await exists(join(dest, ".gitignore")));
      await Deno.remove(tmp, { recursive: true });
    });
  });
});
