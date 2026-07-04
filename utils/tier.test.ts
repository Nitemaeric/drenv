import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";

import {
  parseVersionDir,
  splitVersionInput,
  versionDirName,
  versionLabel,
} from "./tier.ts";

describe("versionDirName", () => {
  it("keeps standard bare and suffixes other tiers", () => {
    assertEquals(versionDirName("7.11", "standard"), "7.11");
    assertEquals(versionDirName("7.11", "pro"), "7.11-pro");
    assertEquals(versionDirName("7.11", "indie"), "7.11-indie");
  });
});

describe("parseVersionDir", () => {
  it("splits a directory name into version and tier", () => {
    assertEquals(parseVersionDir("7.11"), {
      version: "7.11",
      tier: "standard",
    });
    assertEquals(parseVersionDir("7.11-pro"), { version: "7.11", tier: "pro" });
    assertEquals(parseVersionDir("7.11-indie"), {
      version: "7.11",
      tier: "indie",
    });
  });

  it("round-trips with versionDirName", () => {
    for (const dir of ["7.11", "6.4-pro", "5.32-indie"]) {
      const { version, tier } = parseVersionDir(dir);
      assertEquals(versionDirName(version, tier), dir);
    }
  });
});

describe("splitVersionInput", () => {
  it("leaves bare input untiered so it can fall back", () => {
    assertEquals(splitVersionInput("7.11"), { version: "7.11" });
  });

  it("pins an explicit tier suffix (case-insensitively)", () => {
    assertEquals(splitVersionInput("7.11-pro"), {
      version: "7.11",
      tier: "pro",
    });
    assertEquals(splitVersionInput("7.11-INDIE"), {
      version: "7.11",
      tier: "indie",
    });
    assertEquals(splitVersionInput("7.11-standard"), {
      version: "7.11",
      tier: "standard",
    });
  });
});

describe("versionLabel", () => {
  it("formats a directory name for display", () => {
    assertEquals(versionLabel("7.11"), "7.11");
    assertEquals(versionLabel("7.11-pro"), "7.11 Pro");
    assertEquals(versionLabel("7.11-indie"), "7.11 Indie");
  });
});
