import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertRejects } from "@std/assert";
import { ensureDir, exists } from "@std/fs";

import update, { NotInstalled } from "./update.ts";
import { versionsPath } from "../constants.ts";

describe("update", () => {
  let cwd: string;
  let tmp: string;
  let realPrompt: typeof globalThis.prompt;

  beforeEach(async () => {
    cwd = Deno.cwd();
    tmp = await Deno.makeTempDir({ prefix: "drenv-update-" });
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

  it("updates to the latest installed version by default", async () => {
    globalThis.prompt = () => "";

    await update();

    assertEquals(await Deno.readTextFile("./CHANGELOG-CURR.txt"), "* 97.02");
  });

  it("updates to a specific version with --version", async () => {
    globalThis.prompt = () => "";

    await update({ version: "97.01" });

    assertEquals(await Deno.readTextFile("./CHANGELOG-CURR.txt"), "* 97.01");
  });

  it("cancels when the user answers no", async () => {
    globalThis.prompt = () => "n";

    const result = await update({ version: "97.01" });

    assertEquals(result, "drenv: update cancelled");
    assert(!await exists("./CHANGELOG-CURR.txt"));
  });

  it("rejects an uninstalled version", async () => {
    globalThis.prompt = () => "";

    await assertRejects(
      () => update({ version: "0.0" }),
      NotInstalled,
      "version '0.0' not installed",
    );
  });
});
