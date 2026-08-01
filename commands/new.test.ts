import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  it,
} from "@std/testing/bdd";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { ensureDir, exists } from "@std/fs";
import { join } from "@std/path";

import newCommand, { NotInstalled } from "./new.ts";
import { versionsPath } from "../constants.ts";

// Commits need an identity; CI runners have none configured globally.
const GIT_ENV: Record<string, string> = {
  GIT_AUTHOR_NAME: "drenv-test",
  GIT_AUTHOR_EMAIL: "drenv-test@example.com",
  GIT_COMMITTER_NAME: "drenv-test",
  GIT_COMMITTER_EMAIL: "drenv-test@example.com",
};

const gitOut = async (cwd: string, ...args: string[]): Promise<string> => {
  const out = await new Deno.Command("git", { args, cwd }).output();
  return new TextDecoder().decode(out.stdout).trim();
};

describe("new", () => {
  let realPrompt: typeof globalThis.prompt;

  beforeAll(async () => {
    await ensureDir(`${versionsPath}/99.99`);
    await Deno.writeTextFile(`${versionsPath}/99.99/marker.txt`, "v99.99");
  });

  afterAll(async () => {
    await Deno.remove(`${versionsPath}/99.99`, { recursive: true });
  });

  beforeEach(() => {
    realPrompt = globalThis.prompt;
    globalThis.prompt = () => "";
    for (const [k, v] of Object.entries(GIT_ENV)) Deno.env.set(k, v);
  });

  afterEach(() => {
    globalThis.prompt = realPrompt;
    for (const k of Object.keys(GIT_ENV)) Deno.env.delete(k);
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

    it("rejects an existing destination", async () => {
      const tmp = await Deno.makeTempDir({ prefix: "drenv-new-" });
      const dest = join(tmp, "proj");
      await ensureDir(dest);

      await assertRejects(
        () => newCommand(dest, { version: "99.99" }),
        Error,
        "already exists",
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

  describe("git", () => {
    it("initializes a repo with a version-stamped initial commit", async () => {
      const tmp = await Deno.makeTempDir({ prefix: "drenv-new-" });
      const dest = join(tmp, "proj");

      await newCommand(dest, { version: "99.99" });

      assert(await exists(join(dest, ".git"), { isDirectory: true }));
      assertEquals(
        await gitOut(dest, "log", "-1", "--format=%s"),
        "Initial commit. DragonRuby v99.99",
      );
      // Everything — .gitignore included — is in the commit.
      assertEquals(await gitOut(dest, "status", "--porcelain"), "");
      await Deno.remove(tmp, { recursive: true });
    });

    it("skips git and the prompt with --skip-git", async () => {
      const tmp = await Deno.makeTempDir({ prefix: "drenv-new-" });
      const dest = join(tmp, "proj");
      let prompted = false;
      globalThis.prompt = () => {
        prompted = true;
        return "";
      };

      await newCommand(dest, { version: "99.99", skipGit: true });

      assert(!(await exists(join(dest, ".git"))));
      assert(!prompted, "no public/private prompt without git");
      // The base template is the engine-safe (public) one.
      const gitignore = await Deno.readTextFile(join(dest, ".gitignore"));
      assertStringIncludes(gitignore, "dragonruby");
      await Deno.remove(tmp, { recursive: true });
    });

    it("degrades to a warning when git is unavailable", async () => {
      const tmp = await Deno.makeTempDir({ prefix: "drenv-new-" });
      const dest = join(tmp, "proj");
      const realPath = Deno.env.get("PATH") ?? "";
      Deno.env.set("PATH", "");

      try {
        const message = await newCommand(dest, { version: "99.99" });
        assertStringIncludes(message ?? "", "warning: git setup skipped");
      } finally {
        Deno.env.set("PATH", realPath);
      }

      assert(await exists(join(dest, "marker.txt")), "project still created");
      assert(!(await exists(join(dest, ".git"))));
      await Deno.remove(tmp, { recursive: true });
    });
  });

  describe(".gitignore", () => {
    it("public answer gets the engine-ignoring template", async () => {
      const tmp = await Deno.makeTempDir({ prefix: "drenv-new-" });
      const dest = join(tmp, "proj");
      globalThis.prompt = () => "y";

      await newCommand(dest, { version: "99.99" });

      const gitignore = await Deno.readTextFile(join(dest, ".gitignore"));
      assertStringIncludes(gitignore, "dragonruby");
      assertStringIncludes(gitignore, "/samples/");
      assertStringIncludes(gitignore, "/docs/");
      await Deno.remove(tmp, { recursive: true });
    });

    it("defaults to the commit-everything private template", async () => {
      const tmp = await Deno.makeTempDir({ prefix: "drenv-new-" });
      const dest = join(tmp, "proj");
      globalThis.prompt = () => "";

      await newCommand(dest, { version: "99.99" });

      const gitignore = await Deno.readTextFile(join(dest, ".gitignore"));
      assertStringIncludes(gitignore, "/tmp/");
      assertStringIncludes(gitignore, "/logs/");
      assert(!gitignore.includes("dragonruby"), "engine is committed");
      assert(!gitignore.includes("/samples/"));
      await Deno.remove(tmp, { recursive: true });
    });

    it("skips it with --skip-gitignore", async () => {
      const tmp = await Deno.makeTempDir({ prefix: "drenv-new-" });
      const dest = join(tmp, "proj");

      await newCommand(dest, { version: "99.99", skipGitignore: true });

      assert(!await exists(join(dest, ".gitignore")));
      await Deno.remove(tmp, { recursive: true });
    });

    it("--public and --private pick a template without prompting", async () => {
      const tmp = await Deno.makeTempDir({ prefix: "drenv-new-" });
      let prompted = false;
      globalThis.prompt = () => {
        prompted = true;
        return "";
      };

      await newCommand(join(tmp, "pub"), { version: "99.99", public: true });
      await newCommand(join(tmp, "priv"), { version: "99.99", private: true });

      assert(!prompted, "flags must suppress the prompt");
      const pub = await Deno.readTextFile(join(tmp, "pub", ".gitignore"));
      assertStringIncludes(pub, "/samples/");
      const priv = await Deno.readTextFile(join(tmp, "priv", ".gitignore"));
      assert(!priv.includes("/samples/"));
      assertStringIncludes(priv, "/logs/");
      await Deno.remove(tmp, { recursive: true });
    });

    it("an explicit flag beats --skip-git's public default", async () => {
      const tmp = await Deno.makeTempDir({ prefix: "drenv-new-" });
      const dest = join(tmp, "proj");

      await newCommand(dest, {
        version: "99.99",
        skipGit: true,
        private: true,
      });

      const gitignore = await Deno.readTextFile(join(dest, ".gitignore"));
      assert(!gitignore.includes("dragonruby"));
      assert(!(await exists(join(dest, ".git"))));
      await Deno.remove(tmp, { recursive: true });
    });

    it("rejects --public with --private", async () => {
      const tmp = await Deno.makeTempDir({ prefix: "drenv-new-" });

      await assertRejects(
        () =>
          newCommand(join(tmp, "proj"), {
            version: "99.99",
            public: true,
            private: true,
          }),
        Error,
        "mutually exclusive",
      );

      await Deno.remove(tmp, { recursive: true });
    });

    it("rejects --skip-gitignore with a template flag", async () => {
      const tmp = await Deno.makeTempDir({ prefix: "drenv-new-" });

      await assertRejects(
        () =>
          newCommand(join(tmp, "proj"), {
            version: "99.99",
            skipGitignore: true,
            public: true,
          }),
        Error,
        "conflicts",
      );

      await Deno.remove(tmp, { recursive: true });
    });
  });
});
