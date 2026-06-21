import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { join } from "@std/path";

import { InvalidManifest, parseManifest } from "./manifest.ts";
import {
  addDependencyToManifest,
  dependencyBlock,
  deriveName,
  parseSource,
  removeDependencyFromManifest,
} from "./manifest-edit.ts";

describe("parseSource", () => {
  it("parses a github source with a tag shorthand", () => {
    assertEquals(parseSource("github:guitsaru/draco@v0.7.0"), {
      kind: "github",
      value: "guitsaru/draco",
      tag: "v0.7.0",
    });
  });

  it("leaves @ intact for git, url, and path sources", () => {
    assertEquals(
      parseSource("git:https://gitlab.com/me/x.git").value,
      "https://gitlab.com/me/x.git",
    );
    assertEquals(
      parseSource("url:https://example.com/a.rb").value,
      "https://example.com/a.rb",
    );
    assertEquals(parseSource("path:../local_lib").value, "../local_lib");
  });

  it("throws on a missing separator or unknown kind", () => {
    assertThrows(() => parseSource("guitsaru/draco"), InvalidManifest);
    assertThrows(
      () => parseSource("svn:whatever"),
      InvalidManifest,
      "unknown source kind",
    );
  });
});

describe("deriveName", () => {
  it("derives a name from each source kind", () => {
    assertEquals(
      deriveName({ kind: "github", value: "guitsaru/draco" }),
      "draco",
    );
    assertEquals(
      deriveName({ kind: "git", value: "https://gitlab.com/me/my_engine.git" }),
      "my_engine",
    );
    assertEquals(
      deriveName({ kind: "url", value: "https://x.com/scene_manager.rb" }),
      "scene_manager",
    );
    assertEquals(
      deriveName({ kind: "path", value: "../local_lib" }),
      "local_lib",
    );
  });
});

describe("dependencyBlock", () => {
  it("renders source, ref selector, and entrypoint in order", () => {
    assertEquals(
      dependencyBlock({
        name: "draco",
        github: "guitsaru/draco",
        tag: "v0.7.0",
        entrypoint: "draco.rb",
      }),
      '[dependencies.draco]\ngithub = "guitsaru/draco"\ntag = "v0.7.0"\nentrypoint = "draco.rb"\n',
    );
  });
});

describe("manifest add/remove", () => {
  let tmp: string;
  let path: string;

  beforeEach(async () => {
    tmp = await Deno.makeTempDir({ prefix: "drenv-edit-" });
    path = join(tmp, "drenv.toml");
  });

  afterEach(async () => {
    await Deno.remove(tmp, { recursive: true });
  });

  it("creates the manifest on first add", async () => {
    await addDependencyToManifest(path, {
      name: "draco",
      github: "guitsaru/draco",
      entrypoint: "draco.rb",
    });

    const manifest = parseManifest(await Deno.readTextFile(path));
    assertEquals(manifest.dependencies.length, 1);
    assertEquals(manifest.dependencies[0].name, "draco");
  });

  it("appends without clobbering existing dependencies", async () => {
    await addDependencyToManifest(path, {
      name: "draco",
      github: "guitsaru/draco",
      entrypoint: "draco.rb",
    });
    await addDependencyToManifest(path, {
      name: "local",
      path: "../lib",
      entrypoint: "lib.rb",
    });

    const manifest = parseManifest(await Deno.readTextFile(path));
    assertEquals(manifest.dependencies.map((d) => d.name), ["draco", "local"]);
  });

  it("removes a dependency block, keeping the others valid", async () => {
    await addDependencyToManifest(path, {
      name: "draco",
      github: "guitsaru/draco",
      entrypoint: "draco.rb",
    });
    await addDependencyToManifest(path, {
      name: "local",
      path: "../lib",
      entrypoint: "lib.rb",
    });

    await removeDependencyFromManifest(path, "draco");

    const text = await Deno.readTextFile(path);
    assertEquals(text.includes("[dependencies.draco]"), false);
    assertStringIncludes(text, "[dependencies.local]");
    assertEquals(parseManifest(text).dependencies.map((d) => d.name), [
      "local",
    ]);
  });

  it("rejects removing a dependency that isn't present", async () => {
    await addDependencyToManifest(path, {
      name: "local",
      path: "../lib",
      entrypoint: "lib.rb",
    });

    await assertRejects(
      () => removeDependencyFromManifest(path, "nope"),
      InvalidManifest,
    );
  });
});
