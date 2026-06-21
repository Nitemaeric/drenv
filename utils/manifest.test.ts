import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertThrows } from "@std/assert";

import { InvalidManifest, parseManifest, sourceKind } from "./manifest.ts";

describe("parseManifest", () => {
  it("parses dependencies keyed by name", () => {
    const manifest = parseManifest(`
[dependencies.draco]
github = "guitsaru/draco"
tag = "v0.7.0"
entrypoint = "draco.rb"

[dependencies.local_lib]
path = "../local_lib"
entrypoint = "lib/local_lib.rb"
`);

    assertEquals(manifest.dependencies.length, 2);
    assertEquals(manifest.dependencies[0].name, "draco");
    assertEquals(manifest.dependencies[0].github, "guitsaru/draco");
    assertEquals(manifest.dependencies[0].tag, "v0.7.0");
    assertEquals(manifest.dependencies[1].name, "local_lib");
    assertEquals(manifest.dependencies[1].path, "../local_lib");
  });

  it("returns an empty list when there are no dependencies", () => {
    assertEquals(parseManifest("").dependencies, []);
  });

  it("throws when a dependency declares no source", () => {
    assertThrows(
      () => parseManifest('[dependencies.x]\nentrypoint = "x.rb"\n'),
      InvalidManifest,
      "must declare one of",
    );
  });

  it("throws when a dependency declares multiple sources", () => {
    assertThrows(
      () =>
        parseManifest(
          '[dependencies.x]\ngithub = "a/b"\npath = "../x"\nentrypoint = "x.rb"\n',
        ),
      InvalidManifest,
      "multiple sources",
    );
  });
});

describe("sourceKind", () => {
  it("identifies the declared source", () => {
    assertEquals(sourceKind({ name: "x", github: "a/b" }), "github");
    assertEquals(sourceKind({ name: "x", path: "../x" }), "path");
    assertEquals(sourceKind({ name: "x", url: "https://x" }), "url");
    assertEquals(sourceKind({ name: "x", git: "https://x.git" }), "git");
  });
});
