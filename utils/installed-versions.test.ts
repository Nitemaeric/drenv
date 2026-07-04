import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";

import { compareVersions, resolveAgainst } from "./installed-versions.ts";

describe("resolveAgainst", () => {
  const installed = ["7.11", "7.11-pro", "6.4-indie"];

  it("resolves bare input to the highest installed tier", () => {
    assertEquals(resolveAgainst("7.11", installed), "7.11-pro");
  });

  it("works down pro -> indie -> standard", () => {
    assertEquals(
      resolveAgainst("7.11", ["7.11", "7.11-indie", "7.11-pro"]),
      "7.11-pro",
    );
    assertEquals(
      resolveAgainst("7.11", ["7.11", "7.11-indie"]),
      "7.11-indie",
    );
    assertEquals(resolveAgainst("7.11", ["7.11"]), "7.11");
  });

  it("pins an explicit tier suffix", () => {
    assertEquals(resolveAgainst("7.11-pro", installed), "7.11-pro");
    assertEquals(resolveAgainst("6.4-indie", installed), "6.4-indie");
  });

  it("returns undefined when an explicit tier isn't installed", () => {
    assertEquals(resolveAgainst("7.11-indie", installed), undefined);
    assertEquals(resolveAgainst("9.9", installed), undefined);
  });

  it("treats a -standard suffix as the bare directory", () => {
    assertEquals(resolveAgainst("7.11-standard", installed), "7.11");
    assertEquals(resolveAgainst("6.4-standard", installed), undefined);
  });
});

describe("compareVersions", () => {
  it("orders by version number first", () => {
    assertEquals(compareVersions("7.11", "6.4") > 0, true);
    assertEquals(compareVersions("7.11-pro", "7.2") > 0, true);
  });

  it("ranks a richer tier of the same version higher", () => {
    assertEquals(compareVersions("7.11-pro", "7.11") > 0, true);
    assertEquals(compareVersions("7.11", "7.11-indie") < 0, true);
    assertEquals(compareVersions("7.11-pro", "7.11-indie") > 0, true);
  });
});
