import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertThrows } from "@std/assert";

import { matchesTier } from "./install.ts";
import { validateTier } from "../utils/tier.ts";

describe("validateTier", () => {
  it("accepts the known tiers, case-insensitively", () => {
    assertEquals(validateTier("standard"), "standard");
    assertEquals(validateTier("PRO"), "pro");
    assertEquals(validateTier(" Indie "), "indie");
  });

  it("throws on an unknown tier", () => {
    assertThrows(() => validateTier("ultimate"), Error, "unknown tier");
  });
});

describe("matchesTier", () => {
  it("treats non-pro/indie uploads as standard", () => {
    assertEquals(matchesTier("dragonruby-gtk-macos.zip", "standard"), true);
    assertEquals(
      matchesTier("dragonruby-gtk-pro-macos.zip", "standard"),
      false,
    );
    assertEquals(
      matchesTier("dragonruby-gtk-indie-macos.zip", "standard"),
      false,
    );
  });

  it("matches pro and indie by keyword", () => {
    assertEquals(matchesTier("dragonruby-gtk-pro-macos.zip", "pro"), true);
    assertEquals(matchesTier("dragonruby-gtk-indie-macos.zip", "indie"), true);
    assertEquals(matchesTier("dragonruby-gtk-macos.zip", "pro"), false);
  });
});
