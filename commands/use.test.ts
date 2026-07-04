import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertRejects } from "@std/assert";
import { ensureDir, exists } from "@std/fs";

import use, { NotInstalled } from "./use.ts";
import { versionsPath } from "../constants.ts";

describe("use", () => {
  let cwd: string;
  let tmp: string;
  let realPrompt: typeof globalThis.prompt;

  beforeEach(async () => {
    cwd = Deno.cwd();
    tmp = await Deno.makeTempDir({ prefix: "drenv-use-" });
    Deno.chdir(tmp);
    realPrompt = globalThis.prompt;

    // Use high versions so these fixtures are reliably the "latest" installed.
    await ensureDir(`${versionsPath}/97.01`);
    await Deno.writeTextFile(
      `${versionsPath}/97.01/CHANGELOG-CURR.txt`,
      "* 97.01",
    );
    await ensureDir(`${versionsPath}/97.02`);
    await Deno.writeTextFile(
      `${versionsPath}/97.02/CHANGELOG-CURR.txt`,
      "* 97.02",
    );
  });

  afterEach(async () => {
    globalThis.prompt = realPrompt;
    Deno.chdir(cwd);
    await Deno.remove(tmp, { recursive: true });
    await Deno.remove(`${versionsPath}/97.01`, { recursive: true });
    await Deno.remove(`${versionsPath}/97.02`, { recursive: true });
  });

  it("uses the latest installed version by default", async () => {
    globalThis.prompt = () => "";

    await use();

    assertEquals(await Deno.readTextFile("./CHANGELOG-CURR.txt"), "* 97.02");
  });

  it("uses a specific version when given one", async () => {
    globalThis.prompt = () => "";

    await use("97.01");

    assertEquals(await Deno.readTextFile("./CHANGELOG-CURR.txt"), "* 97.01");
  });

  it("cancels when the user answers no", async () => {
    globalThis.prompt = () => "n";

    const result = await use("97.01");

    assertEquals(result, "drenv: cancelled");
    assert(!await exists("./CHANGELOG-CURR.txt"));
  });

  it("rejects an uninstalled version", async () => {
    globalThis.prompt = () => "";

    await assertRejects(
      () => use("0.0"),
      NotInstalled,
      "version '0.0' not installed",
    );
  });
});
