import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { ensureDir, exists } from "@std/fs";

import uninstall, { NotInstalled } from "./uninstall.ts";
import { versionsPath } from "../constants.ts";

describe("uninstall", () => {
  let realPrompt: typeof globalThis.prompt;

  beforeEach(async () => {
    realPrompt = globalThis.prompt;
    await ensureDir(`${versionsPath}/98.01`);
    await Deno.writeTextFile(`${versionsPath}/98.01/marker.txt`, "v98.01");
  });

  afterEach(async () => {
    globalThis.prompt = realPrompt;
    await Deno.remove(`${versionsPath}/98.01`, { recursive: true })
      .catch(() => {});
  });

  it("removes an installed version when confirmed", async () => {
    globalThis.prompt = () => "y";

    const message = await uninstall("98.01");

    assert(!await exists(`${versionsPath}/98.01`));
    assertStringIncludes(message ?? "", "Uninstalled");
  });

  it("cancels by default when the user doesn't confirm", async () => {
    globalThis.prompt = () => "";

    const message = await uninstall("98.01");

    assertEquals(message, "drenv: cancelled");
    assert(await exists(`${versionsPath}/98.01`));
  });

  it("skips the prompt with --yes", async () => {
    // No prompt override — this would hang or cancel if it prompted.
    const message = await uninstall("98.01", { yes: true });

    assert(!await exists(`${versionsPath}/98.01`));
    assertStringIncludes(message ?? "", "Uninstalled");
  });

  it("rejects an uninstalled version", async () => {
    globalThis.prompt = () => "y";

    await assertRejects(
      () => uninstall("0.0"),
      NotInstalled,
      "version '0.0' not installed",
    );
  });
});
