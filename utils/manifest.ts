import { parse } from "@std/toml";

export type SourceKind = "github" | "url" | "git" | "path";

const SOURCE_KINDS: SourceKind[] = ["github", "url", "git", "path"];

export type DependencySpec = {
  name: string;
  entrypoint?: string;
  github?: string;
  url?: string;
  git?: string;
  path?: string;
  tag?: string;
  branch?: string;
  ref?: string;
};

/** A library's self-description, declared in its own `[package]` table. */
export type PackageSpec = {
  /** Subdirectory of the source that holds the library (default "."). */
  root?: string;
  /** Entrypoint to require, relative to `root`. */
  entrypoint?: string;
  /**
   * Extra paths (files or directories), relative to the repo root, to vendor
   * alongside the library — e.g. sprites/sounds/data that live outside `root`.
   * Copied into `vendor/<name>/<path>`, preserving their names.
   */
  include?: string[];
};

export type Manifest = {
  dependencies: DependencySpec[];
  package?: PackageSpec;
};

export class InvalidManifest extends Error {
  constructor(message: string) {
    super(`drenv: ${message}`);
    this.name = "InvalidManifest";
  }
}

/** Returns the single source kind a dependency declares. */
export const sourceKind = (spec: DependencySpec): SourceKind => {
  const declared = SOURCE_KINDS.filter((kind) => spec[kind] != null);

  if (declared.length === 0) {
    throw new InvalidManifest(
      `dependency '${spec.name}' must declare one of: ${
        SOURCE_KINDS.join(", ")
      }`,
    );
  }

  if (declared.length > 1) {
    throw new InvalidManifest(
      `dependency '${spec.name}' declares multiple sources: ${
        declared.join(", ")
      }`,
    );
  }

  return declared[0];
};

export const parseManifest = (text: string): Manifest => {
  const data = parse(text) as {
    dependencies?: Record<string, Record<string, unknown>>;
    package?: PackageSpec;
  };

  const dependencies = Object.entries(data.dependencies ?? {}).map(
    ([name, spec]) => ({ name, ...spec }) as DependencySpec,
  );

  // Validate sources eagerly so errors surface before any network or disk work.
  for (const spec of dependencies) {
    sourceKind(spec);
  }

  return { dependencies, package: data.package };
};

export const readManifest = async (path: string): Promise<Manifest> => {
  let text: string;

  try {
    text = await Deno.readTextFile(path);
  } catch {
    throw new InvalidManifest(`could not read manifest at ${path}`);
  }

  return parseManifest(text);
};
