export type Tier = "standard" | "indie" | "pro";

export const TIERS: Tier[] = ["standard", "indie", "pro"];

// Tiers from richest to plainest. A bare version resolves to the highest tier a
// user has installed, and same-version installs sort highest-tier-first.
export const TIER_PRECEDENCE: Tier[] = ["pro", "indie", "standard"];

/** A sortable rank for a tier — higher means richer (pro > indie > standard). */
export const tierRank = (tier: Tier): number =>
  TIER_PRECEDENCE.length - TIER_PRECEDENCE.indexOf(tier);

/** Validates and normalizes a tier string. */
export const validateTier = (tier: string): Tier => {
  const value = tier.trim().toLowerCase();
  if ((TIERS as string[]).includes(value)) return value as Tier;
  throw new Error(
    `drenv: unknown tier '${tier}' (expected ${TIERS.join(", ")})`,
  );
};

// Installs are keyed by version and tier. Standard keeps the plain version as
// its directory name (`7.11`); indie and pro get a suffix (`7.11-pro`) so tiers
// of the same version can live side by side.

/** The directory name for a version at a given tier. */
export const versionDirName = (version: string, tier: Tier): string =>
  tier === "standard" ? version : `${version}-${tier}`;

/** Splits a directory name back into its version and tier. */
export const parseVersionDir = (
  dirName: string,
): { version: string; tier: Tier } => {
  const match = dirName.match(/^(.*)-(indie|pro)$/);
  if (match) return { version: match[1], tier: match[2] as Tier };
  return { version: dirName, tier: "standard" };
};

/**
 * Splits user input into a version and an explicit tier. Bare input (`7.11`)
 * has no tier and should fall back across tiers; a suffix (`7.11-pro`,
 * `7.11-standard`) pins the tier.
 */
export const splitVersionInput = (
  input: string,
): { version: string; tier?: Tier } => {
  const match = input.match(/^(.*)-(standard|indie|pro)$/i);
  if (match) return { version: match[1], tier: match[2].toLowerCase() as Tier };
  return { version: input };
};

/** A human label for a directory name, e.g. `7.11-pro` -> `7.11 Pro`. */
export const versionLabel = (dirName: string): string => {
  const { version, tier } = parseVersionDir(dirName);
  return tier === "standard"
    ? version
    : `${version} ${tier[0].toUpperCase()}${tier.slice(1)}`;
};
