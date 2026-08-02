import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { ensureDir } from "@std/fs";

import gitignore from "./gitignore.ts";
import { ProjectNotFound } from "../utils/project.ts";

describe("gitignore", () => {
  let cwd: string;
  let tmp: string;
  let realPrompt: typeof globalThis.prompt;

  beforeEach(async () => {
    cwd = Deno.cwd();
    tmp = await Deno.makeTempDir({ prefix: "drenv-gitignore-" });
    Deno.chdir(tmp);
    await ensureDir(`${tmp}/mygame`);
    realPrompt = globalThis.prompt;
  });

  afterEach(async () => {
    globalThis.prompt = realPrompt;
    Deno.chdir(cwd);
    await Deno.remove(tmp, { recursive: true });
  });

  it("writes the public template with --public", async () => {
    const message = await gitignore({ public: true });

    const content = await Deno.readTextFile("./.gitignore");
    assertStringIncludes(content, "/samples/");
    assertStringIncludes(content, "dragonruby");
    // Pro iOS toolchain, headers, and distribution files are engine too.
    assertStringIncludes(content, "/dragonruby-ios.app/");
    assertStringIncludes(content, "/dragonruby-ios-simulator.app/");
    assertStringIncludes(content, "/include/");
    assertStringIncludes(content, "/eula.txt");
    assertStringIncludes(message ?? "", "public repository template");
  });

  it("writes the private template with --private", async () => {
    await gitignore({ private: true });

    const content = await Deno.readTextFile("./.gitignore");
    assertStringIncludes(content, "/logs/");
    assert(!content.includes("/samples/"));
  });

  it("prompts for the template when no flag is given", async () => {
    globalThis.prompt = () => "y";

    const message = await gitignore();

    const content = await Deno.readTextFile("./.gitignore");
    assertStringIncludes(content, "/samples/");
    assertStringIncludes(message ?? "", "public repository template");
  });

  it("refuses to overwrite an existing file by default", async () => {
    await Deno.writeTextFile("./.gitignore", "mine");
    globalThis.prompt = () => "";

    const message = await gitignore({ public: true });

    assertEquals(await Deno.readTextFile("./.gitignore"), "mine");
    assertStringIncludes(message ?? "", "cancelled");
  });

  it("overwrites an existing file when confirmed", async () => {
    await Deno.writeTextFile("./.gitignore", "mine");
    globalThis.prompt = () => "y";

    await gitignore({ private: true });

    assertStringIncludes(await Deno.readTextFile("./.gitignore"), "/logs/");
  });

  it("rejects --public with --private", async () => {
    await assertRejects(
      () => gitignore({ public: true, private: true }),
      Error,
      "mutually exclusive",
    );
  });

  it("rejects outside a project", async () => {
    await Deno.remove(`${tmp}/mygame`, { recursive: true });

    await assertRejects(() => gitignore({ public: true }), ProjectNotFound);
  });
});
