import { afterAll, beforeAll, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertFalse } from "@std/assert";
import { join, toFileUrl } from "@std/path";

import { writeLock } from "../../utils/lockfile.ts";
import { Ruby } from "./ruby.ts";
import { detectProjectDirs, vendorSkips, Workspace } from "./workspace.ts";

let ruby: Ruby;
beforeAll(async () => {
  ruby = await Ruby.init();
});

const uri = "file:///workspace/a.rb";

describe("Workspace.indexFile", () => {
  it("indexes class/module/method defs with kind and container", () => {
    const ws = new Workspace(ruby);
    ws.indexFile(
      uri,
      [
        "module Game",
        "  class Player",
        "    def move",
        "    end",
        "  end",
        "end",
        "",
      ].join("\n"),
    );

    const mod = ws.defs.get("Game")!;
    assertEquals(mod.length, 1);
    assertEquals(mod[0].kind, "module");
    assertEquals(mod[0].container, undefined);

    const cls = ws.defs.get("Player")!;
    assertEquals(cls[0].kind, "class");
    assertEquals(cls[0].container, "Game");

    const method = ws.defs.get("move")!;
    assertEquals(method[0].kind, "method");
    assertEquals(method[0].container, "Game::Player");
    // Range points at the name token, not the whole def.
    assertEquals(method[0].range.start.line, 2);
    assertEquals(method[0].uri, uri);
  });

  it("captures a class superclass as written", () => {
    const ws = new Workspace(ruby);
    ws.indexFile(uri, "class Player < Scene\nend\n");
    assertEquals(ws.defs.get("Player")![0].superclass, "Scene");

    ws.indexFile(uri, "class Loner\nend\n");
    assertEquals(ws.defs.get("Loner")![0].superclass, undefined);
  });

  it("defines methods for attr_reader/writer/accessor symbols with docs", () => {
    const ws = new Workspace(ruby);
    ws.indexFile(
      uri,
      [
        "class Player",
        "  # the coordinates",
        "  attr_accessor :x, :y",
        "  attr_reader :z",
        "end",
        "",
      ].join("\n"),
    );

    for (const name of ["x", "y", "z"]) {
      const def = ws.defs.get(name)!;
      assertEquals(def[0].kind, "method");
      assertEquals(def[0].container, "Player");
    }
    assertEquals(ws.defs.get("x")![0].doc, "the coordinates");
    assertEquals(ws.defs.get("y")![0].doc, "the coordinates");
    // A different statement above z, no comment.
    assertEquals(ws.defs.get("z")![0].doc, undefined);
  });

  it("walks contiguous comment lines above a def into its doc", () => {
    const ws = new Workspace(ruby);
    ws.indexFile(
      uri,
      [
        "# First line.",
        "# Second line.",
        "class Player",
        "end",
        "",
      ].join("\n"),
    );
    assertEquals(ws.defs.get("Player")![0].doc, "First line.\nSecond line.");
  });

  it("re-indexing a uri replaces that file's defs and bumps generation", () => {
    const ws = new Workspace(ruby);
    const g0 = ws.generation;
    ws.indexFile(uri, "class Old\nend\n");
    assert(ws.generation > g0);
    assert(ws.defs.has("Old"));

    const g1 = ws.generation;
    ws.indexFile(uri, "class New\nend\n");
    assert(ws.generation > g1);
    assertFalse(ws.defs.has("Old"));
    assert(ws.defs.has("New"));
  });

  it("keeps defs from other files when one file is re-indexed", () => {
    const ws = new Workspace(ruby);
    const other = "file:///workspace/b.rb";
    ws.indexFile(uri, "class A\nend\n");
    ws.indexFile(other, "class B\nend\n");
    ws.indexFile(uri, "class A2\nend\n");
    assert(ws.defs.has("A2"));
    assert(ws.defs.has("B"));
    assertFalse(ws.defs.has("A"));
  });

  it("exposes fileText/fileTree/fileUris for indexed files", () => {
    const ws = new Workspace(ruby);
    const text = "class A\nend\n";
    ws.indexFile(uri, text);
    assertEquals(ws.fileText(uri), text);
    assertEquals(ws.fileTree(uri)?.rootNode.type, "program");
    assertEquals([...ws.fileUris()], [uri]);
    assertEquals(ws.fileText("file:///nope.rb"), undefined);
    assertEquals(ws.fileTree("file:///nope.rb"), undefined);
  });
});

describe("Workspace.removeFile", () => {
  it("drops the file's defs, text, and tree, and bumps generation", () => {
    const ws = new Workspace(ruby);
    const other = "file:///workspace/b.rb";
    ws.indexFile(uri, "class A\nend\n");
    ws.indexFile(other, "class B\nend\n");

    const g = ws.generation;
    ws.removeFile(uri);
    assert(ws.generation > g);
    assertFalse(ws.defs.has("A"));
    assertEquals(ws.fileText(uri), undefined);
    assertEquals(ws.fileTree(uri), undefined);
    // Other files untouched.
    assert(ws.defs.has("B"));
    assertEquals([...ws.fileUris()], [other]);
  });
});

describe("detectProjectDirs", () => {
  let root: string;
  beforeAll(async () => {
    root = await Deno.makeTempDir();
  });
  afterAll(async () => {
    await Deno.remove(root, { recursive: true });
  });

  it("detects the root when it carries a marker", async () => {
    const dir = await Deno.makeTempDir();
    try {
      await Deno.mkdir(join(dir, "mygame"));
      assertEquals(await detectProjectDirs(dir), [dir]);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });

  it("detects a child project one level down (monorepo)", async () => {
    const dir = await Deno.makeTempDir();
    try {
      await Deno.mkdir(join(dir, "demo"));
      await Deno.writeTextFile(join(dir, "demo", "dragonruby"), "");
      await Deno.mkdir(join(dir, ".hidden"));
      await Deno.writeTextFile(join(dir, ".hidden", "dragonruby"), "");
      assertEquals(await detectProjectDirs(dir), [join(dir, "demo")]);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });

  it("treats a root drenv.toml as a library project", async () => {
    const dir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(join(dir, "drenv.toml"), "");
      assertEquals(await detectProjectDirs(dir), [dir]);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });

  it("returns nothing for a plain directory", async () => {
    const dir = await Deno.makeTempDir();
    try {
      assertEquals(await detectProjectDirs(dir), []);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });
});

const lockWith = (deps: { name: string; source: string }[]) => ({
  lockfile_version: 1,
  manifest_digest: "test",
  dependencies: deps.map((d) => ({ ...d, require: [] as string[] })),
});

describe("vendorSkips", () => {
  it("skips path: deps that resolve into indexedRoots", async () => {
    const base = await Deno.makeTempDir();
    try {
      const source = join(base, "shared");
      await writeLock(
        join(base, "drenv.lock"),
        lockWith([
          { name: "shared", source: "path:./shared" },
          { name: "elsewhere", source: "path:./elsewhere" },
          { name: "remote", source: "git:https://example.com/x.git" },
        ]),
      );

      const skips = await vendorSkips(base, new Set([source]));
      assert(skips.has("shared"));
      assertFalse(skips.has("elsewhere"));
      assertFalse(skips.has("remote"));
    } finally {
      await Deno.remove(base, { recursive: true });
    }
  });

  it("returns an empty set when no lock exists", async () => {
    const base = await Deno.makeTempDir();
    try {
      assertEquals((await vendorSkips(base, new Set())).size, 0);
    } finally {
      await Deno.remove(base, { recursive: true });
    }
  });
});

describe("Workspace.scan", () => {
  it("indexes app/lib and vendored packages, skipping twins", async () => {
    const root = await Deno.makeTempDir();
    try {
      const write = async (rel: string, text: string) => {
        const path = join(root, rel);
        await Deno.mkdir(join(path, ".."), { recursive: true });
        await Deno.writeTextFile(path, text);
      };

      await write("mygame/app/game.rb", "class Game\nend\n");
      await write("mygame/vendor/plugin/plug.rb", "class Plugin\nend\n");
      await write("mygame/vendor/shared/thing.rb", "class Twin\nend\n");

      const source = join(root, "mygame", "shared-src");
      await writeLock(
        join(root, "mygame", "drenv.lock"),
        lockWith([{ name: "shared", source: "path:./shared-src" }]),
      );

      const ws = new Workspace(ruby);
      await ws.scan([root], new Set([source]));

      assert(ws.defs.has("Game"));
      assert(ws.defs.has("Plugin"));
      // The vendored twin of workspace source is skipped.
      assertFalse(ws.defs.has("Twin"));

      const gameUri = toFileUrl(join(root, "mygame", "app", "game.rb")).href;
      assertEquals(ws.defs.get("Game")![0].uri, gameUri);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("swallows missing directories", async () => {
    const root = await Deno.makeTempDir();
    try {
      const ws = new Workspace(ruby);
      await ws.scan([root], new Set());
      assertEquals(ws.defs.size, 0);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });
});
