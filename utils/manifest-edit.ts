import { ensureDir } from "@std/fs";
import { basename, dirname } from "@std/path";

import {
  type DependencySpec,
  InvalidManifest,
  type SourceKind,
  sourceKind,
} from "./manifest.ts";

const SOURCE_KINDS: SourceKind[] = ["github", "url", "git", "path"];

export type ParsedSource = {
  kind: SourceKind;
  value: string;
  /** Tag parsed from a `github:owner/repo@tag` shorthand, if present. */
  tag?: string;
};

/** Infers a source kind from an unprefixed spec. */
const inferKind = (spec: string): SourceKind | undefined => {
  if (/^[./]/.test(spec)) return "path";
  if (/^https?:\/\//.test(spec)) return spec.endsWith(".git") ? "git" : "url";
  if (/^git@/.test(spec) || spec.endsWith(".git")) return "git";
  if (/^[\w.-]+\/[\w.-]+(@[\w.-]+)?$/.test(spec)) return "github";
  return undefined;
};

const withTag = (
  kind: SourceKind,
  value: string,
  spec: string,
): ParsedSource => {
  let tag: string | undefined;

  // `owner/repo@tag` shorthand — github only, since git/url/path values can
  // legitimately contain `@`.
  if (kind === "github") {
    const at = value.lastIndexOf("@");
    if (at > 0) {
      tag = value.slice(at + 1);
      value = value.slice(0, at);
    }
  }

  if (!value) {
    throw new InvalidManifest(`source '${spec}' is missing a value`);
  }

  return { kind, value, tag };
};

/**
 * Parses a source spec into a kind and value. An explicit `kind:value` prefix
 * wins; otherwise the kind is inferred — `../lib` and `/abs` are paths,
 * `owner/repo[@tag]` is github, and `http(s)://…`/`git@…`/`*.git` are url/git.
 */
export const parseSource = (spec: string): ParsedSource => {
  const separator = spec.indexOf(":");

  if (separator !== -1) {
    const prefix = spec.slice(0, separator);
    if (SOURCE_KINDS.includes(prefix as SourceKind)) {
      return withTag(prefix as SourceKind, spec.slice(separator + 1), spec);
    }
  }

  const kind = inferKind(spec);
  if (!kind) {
    throw new InvalidManifest(
      `invalid source '${spec}' (use a path like ../lib, owner/repo, a URL, or an explicit github:/git:/url:/path: prefix)`,
    );
  }

  return withTag(kind, spec, spec);
};

/** Derives a default dependency name from a parsed source. */
export const deriveName = (source: ParsedSource): string => {
  switch (source.kind) {
    case "github":
      return source.value.split("/").pop() ?? source.value;
    case "git":
      return basename(source.value).replace(/\.git$/, "");
    case "url":
      return basename(new URL(source.value).pathname).replace(/\.[^.]+$/, "");
    case "path":
      return basename(source.value.replace(/\/+$/, ""));
  }
};

/** Renders a single `[dependencies.<name>]` TOML block. */
export const dependencyBlock = (dep: DependencySpec): string => {
  const kind = sourceKind(dep);
  const lines = [`[dependencies.${dep.name}]`, `${kind} = "${dep[kind]}"`];

  if (dep.tag) lines.push(`tag = "${dep.tag}"`);
  if (dep.branch) lines.push(`branch = "${dep.branch}"`);
  if (dep.ref) lines.push(`ref = "${dep.ref}"`);
  if (dep.entrypoint) lines.push(`entrypoint = "${dep.entrypoint}"`);

  return lines.join("\n") + "\n";
};

/** Appends a dependency block to the manifest, creating the file if needed. */
export const addDependencyToManifest = async (
  path: string,
  dep: DependencySpec,
): Promise<void> => {
  let existing = "";
  try {
    existing = await Deno.readTextFile(path);
  } catch {
    // Manifest doesn't exist yet — it will be created below.
  }

  const prefix = existing.trim() ? `${existing.trimEnd()}\n\n` : "";

  await ensureDir(dirname(path));
  await Deno.writeTextFile(path, prefix + dependencyBlock(dep));
};

/** Removes a dependency's block from the manifest text. */
export const removeDependencyFromManifest = async (
  path: string,
  name: string,
): Promise<void> => {
  const lines = (await Deno.readTextFile(path)).split("\n");
  const header = `[dependencies.${name}]`;

  const start = lines.findIndex((line) => line.trim() === header);
  if (start === -1) {
    throw new InvalidManifest(`dependency '${name}' is not in the manifest`);
  }

  let end = start + 1;
  while (end < lines.length && !lines[end].trim().startsWith("[")) {
    end++;
  }

  lines.splice(start, end - start);

  const result = lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(
    /^\n+/,
    "",
  );

  await Deno.writeTextFile(path, `${result.trimEnd()}\n`);
};
