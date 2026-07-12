import { parse } from "@std/toml";

import {
  type DependencySpec,
  InvalidManifest,
  SOURCE_KINDS,
  sourceKind,
} from "../../../utils/manifest.ts";
import type { Pos, Range } from "../types.ts";

// Schema, mirrored from utils/manifest DependencySpec/PackageSpec. Source keys
// stay derived from SOURCE_KINDS so the two never drift.
const SOURCE_KEY_DOCS: Record<string, string> = {
  github: "`owner/repo` on GitHub.",
  url: "Direct URL to a zip/tarball.",
  git: "Git clone URL.",
  path: "Local path, relative to this manifest.",
};

const DEPENDENCY_KEYS: Record<string, string> = {
  ...Object.fromEntries(SOURCE_KINDS.map((k) => [k, SOURCE_KEY_DOCS[k]])),
  tag: "Git tag to pin to (github/git sources).",
  branch: "Git branch to track (github/git sources).",
  ref: "Exact git ref/sha to pin to (github/git sources).",
  entrypoint: "File to require, relative to the package root.",
};

const PACKAGE_KEYS: Record<string, string> = {
  root: "Subdirectory holding the library (default `.`).",
  entrypoint: "File to require, relative to `root`.",
  include: "Extra files/dirs to vendor alongside the library.",
};

const ARRAY_KEYS = new Set(["include"]);

const TOP_LEVEL = new Set(["package", "dependencies"]);

const diag = (range: Range, severity: number, message: string) => ({
  range,
  severity,
  source: "drenv",
  message,
});

const lineRange = (lines: string[], idx: number): Range => ({
  start: { line: idx, character: 0 },
  end: { line: idx, character: (lines[idx] ?? "").length },
});

const WHOLE_FILE: Range = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 0 },
};

const headerName = (line: string): string | null => {
  const m = line.match(/^\s*\[\s*(.+?)\s*\]/);
  if (!m) return null;
  return m[1]
    .split(".")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .join(".");
};

type Section = { name: string; header: number; start: number; end: number };

/** Splits the file into table sections plus the implicit top-level section
 * (everything before the first `[header]`). Ranges are best-effort only. */
const scanSections = (lines: string[]): Section[] => {
  const sections: Section[] = [{ name: "", header: -1, start: 0, end: 0 }];
  for (let i = 0; i < lines.length; i++) {
    const name = headerName(lines[i]);
    if (name === null) continue;
    sections[sections.length - 1].end = i;
    sections.push({ name, header: i, start: i + 1, end: lines.length });
  }
  sections[sections.length - 1].end = lines.length;
  if (sections[0].header === -1 && sections.length > 1) {
    sections[0].end = sections[1].header;
  } else if (sections[0].header === -1) {
    sections[0].end = lines.length;
  }
  return sections;
};

const keyLine = (lines: string[], section: Section, key: string): number => {
  const pat = new RegExp(`^\\s*(?:${key}|["']${key}["'])\\s*=`);
  for (let i = section.start; i < section.end; i++) {
    if (pat.test(lines[i])) return i;
  }
  return -1;
};

const findSection = (sections: Section[], name: string): Section | undefined =>
  sections.find((s) => s.name === name);

const typeName = (v: unknown): string =>
  Array.isArray(v) ? "array" : v === null ? "null" : typeof v;

const checkType = (
  lines: string[],
  section: Section,
  key: string,
  value: unknown,
  out: unknown[],
) => {
  const wantsArray = ARRAY_KEYS.has(key);
  const ok = wantsArray
    ? Array.isArray(value) && value.every((e) => typeof e === "string")
    : typeof value === "string";
  if (ok) return;
  const line = keyLine(lines, section, key);
  const range = line === -1 ? lineRange(lines, section.header) : lineRange(
    lines,
    Math.max(line, 0),
  );
  out.push(diag(
    range,
    1,
    wantsArray
      ? `\`${key}\` must be an array of strings — got ${typeName(value)}`
      : `\`${key}\` must be a string — got ${typeName(value)}`,
  ));
};

const checkTable = (
  lines: string[],
  section: Section | undefined,
  fallback: Range,
  table: Record<string, unknown>,
  valid: Record<string, string>,
  label: string,
  out: unknown[],
) => {
  for (const [key, value] of Object.entries(table)) {
    if (!(key in valid)) {
      const line = section ? keyLine(lines, section, key) : -1;
      out.push(diag(
        line === -1 ? fallback : lineRange(lines, line),
        2,
        `\`${key}\` is not a known ${label} key — accepted: ${
          Object.keys(valid).join(", ")
        }`,
      ));
      continue;
    }
    if (section) checkType(lines, section, key, value, out);
  }
};

/** drenv.toml validation. TOML syntax errors become an Error diagnostic with a
 * best-effort range; schema issues (unknown keys, wrong types) and the source
 * rules reused from utils/manifest become their own diagnostics. */
export function manifestDiagnostics(text: string): unknown[] {
  const lines = text.split("\n");

  let data: Record<string, unknown>;
  try {
    data = parse(text) as Record<string, unknown>;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const m = message.match(/line (\d+),\s*column (\d+)/i);
    const line = m ? Math.max(Number(m[1]) - 1, 0) : 0;
    const char = m ? Math.max(Number(m[2]) - 1, 0) : 0;
    const end = (lines[line] ?? "").length;
    return [diag(
      { start: { line, character: char }, end: { line, character: end } },
      1,
      message,
    )];
  }

  const out: unknown[] = [];
  const sections = scanSections(lines);

  for (const key of Object.keys(data)) {
    if (TOP_LEVEL.has(key)) continue;
    const header = sections.find((s) =>
      s.name === key || s.name.startsWith(`${key}.`)
    );
    const top = sections[0];
    const line = header ? header.header : keyLine(lines, top, key);
    out.push(diag(
      line === -1 ? WHOLE_FILE : lineRange(lines, line),
      2,
      `\`${key}\` is not a known top-level key — accepted: ${
        [...TOP_LEVEL].join(", ")
      }`,
    ));
  }

  const pkg = data.package;
  if (pkg !== undefined) {
    const section = findSection(sections, "package");
    const fallback = section ? lineRange(lines, section.header) : WHOLE_FILE;
    if (typeof pkg !== "object" || pkg === null || Array.isArray(pkg)) {
      out.push(diag(fallback, 1, "`[package]` must be a table"));
    } else {
      checkTable(
        lines,
        section,
        fallback,
        pkg as Record<string, unknown>,
        PACKAGE_KEYS,
        "[package]",
        out,
      );
    }
  }

  const deps = data.dependencies;
  if (deps !== undefined) {
    if (typeof deps !== "object" || deps === null || Array.isArray(deps)) {
      out.push(diag(
        findSection(sections, "dependencies")
          ? lineRange(lines, findSection(sections, "dependencies")!.header)
          : WHOLE_FILE,
        1,
        "`[dependencies]` must be a table",
      ));
    } else {
      for (const [name, spec] of Object.entries(deps)) {
        const section = findSection(sections, `dependencies.${name}`);
        const fallback = section
          ? lineRange(lines, section.header)
          : depFallback(lines, name);
        if (typeof spec !== "object" || spec === null || Array.isArray(spec)) {
          out.push(diag(fallback, 1, `dependency \`${name}\` must be a table`));
          continue;
        }
        checkTable(
          lines,
          section,
          fallback,
          spec as Record<string, unknown>,
          DEPENDENCY_KEYS,
          "dependency",
          out,
        );
        // Reuse the repo's source rule (exactly one of github/url/git/path).
        try {
          sourceKind({ name, ...spec } as DependencySpec);
        } catch (e) {
          if (e instanceof InvalidManifest) {
            out.push(diag(fallback, 1, e.message));
          }
        }
      }
    }
  }

  return out;
}

/** Locates an inline `name = { … }` dependency under a bare `[dependencies]`. */
const depFallback = (lines: string[], name: string): Range => {
  const deps = scanSections(lines).find((s) => s.name === "dependencies");
  if (deps) {
    const line = keyLine(lines, deps, name);
    if (line !== -1) return lineRange(lines, line);
  }
  return WHOLE_FILE;
};

const item = (label: string, kind: number, doc?: string) => ({
  label,
  kind,
  ...(doc ? { documentation: { kind: "markdown", value: doc } } : {}),
});

const enclosingSection = (lines: string[], line: number): string | null => {
  for (let i = Math.min(line, lines.length - 1); i >= 0; i--) {
    const name = headerName(lines[i]);
    if (name !== null) return name;
  }
  return null;
};

/** Section names at a `[`, keys inside the enclosing section. */
export function manifestCompletion(text: string, pos: Pos): unknown[] {
  const lines = text.split("\n");
  const upto = (lines[pos.line] ?? "").slice(0, pos.character);

  if (/^\s*\[/.test(upto)) {
    return [
      item("package", 9, "This library's self-description."),
      item("dependencies", 9, "Declare a dependency table."),
    ];
  }

  const section = enclosingSection(lines, pos.line);
  if (section === null) return [];
  if (section === "package") {
    return Object.entries(PACKAGE_KEYS).map(([k, doc]) => item(k, 10, doc));
  }
  if (section.startsWith("dependencies.")) {
    return Object.entries(DEPENDENCY_KEYS).map(([k, doc]) => item(k, 10, doc));
  }
  return [];
}
