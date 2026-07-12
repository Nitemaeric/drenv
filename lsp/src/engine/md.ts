// Markdown parsing primitives shared by the engine index builders. The engine's
// `docs/api/*.md` are the same source docs.dragonruby.org serves; we read method
// names from headings, prose docs from the body below them, class-level methods
// from bullet lists, and — only when unambiguous — signatures from code fences.

import type { Node, Ruby } from "../ruby.ts";
import type { Param } from "../types.ts";
import { extractParams, renderSignature } from "../analyze.ts";

export type Heading = {
  level: number;
  text: string; // the heading text, without the leading `#`s
  body: string[]; // lines until the next heading (code-fence aware)
};

/** Headings in document order. Lines inside ```code fences``` are never treated
 * as headings — the runtime docs embed Ruby whose `# comment` lines would
 * otherwise masquerade as markdown headings (e.g. outputs.md's
 * `# mygame/app/main.rb`). */
export function parseHeadings(text: string): Heading[] {
  const out: Heading[] = [];
  let fenced = false;
  let current: Heading | null = null;
  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const m = fenced ? null : line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (m) {
      current = { level: m[1].length, text: m[2], body: [] };
      out.push(current);
    } else if (current) {
      current.body.push(line);
    }
  }
  return out;
}

/** The leading identifier of a backticked token, discarding any trailing
 * signature or arg text: `rect(offset: nil)` → `rect`, `inside_rect? rect` →
 * `inside_rect?`. Null when the token doesn't start with a lowercase identifier
 * (skips `Array`, `(left|right)_analog`, category words). */
export function leadingIdent(token: string): string | null {
  return token.match(/^[a-z_][\w?!]*/)?.[0] ?? null;
}

/** Every member name a heading contributes: one leading identifier per
 * backticked token (`,`/`OR`-separated names are already separately backticked
 * in the shipped docs). Backtick-free category headings yield nothing. */
export function memberNames(headingText: string): string[] {
  const names: string[] = [];
  for (const m of headingText.matchAll(/`([^`]+)`/g)) {
    const name = leadingIdent(m[1]);
    if (name) names.push(name);
  }
  return names;
}

/** First prose paragraph under a heading: consecutive non-blank lines until the
 * next blank line or a code fence. Empty when the body opens with a fence. */
export function firstProse(body: string[]): string {
  const lines: string[] = [];
  let started = false;
  for (const line of body) {
    if (/^\s*```/.test(line)) break;
    if (line.trim() === "") {
      if (started) break;
      continue;
    }
    started = true;
    lines.push(line.trim());
  }
  return lines.join("\n").trim();
}

/** Class-level (constant-receiver) method names from a `` `Class` Class Methods ``
 * bullet list — the channel that drives `Array.filter_map` completion. */
export function classMethodBullets(text: string, className: string): string[] {
  const section = text.split(
    new RegExp(`^#{1,6} \`${className}\` Class Methods\\s*$`, "m"),
  )[1];
  if (!section) return [];
  const body = section.split(/^#{1,6} /m)[0];
  return [...body.matchAll(/^- `([\w?!]+)`/gm)].map((m) => m[1]);
}

/** Ruby code-fence bodies within a section. */
export function codeFences(body: string[]): string[] {
  const fences: string[] = [];
  let inside = false;
  let buf: string[] = [];
  for (const line of body) {
    if (/^\s*```/.test(line)) {
      if (inside) {
        fences.push(buf.join("\n"));
        buf = [];
      }
      inside = !inside;
      continue;
    }
    if (inside) buf.push(line);
  }
  return fences;
}

const collectDefs = (node: Node, name: string, out: Node[]): void => {
  if (node.type === "method" && node.childForFieldName("name")?.text === name) {
    out.push(node);
  }
  for (let i = 0; i < node.namedChildCount; i++) {
    collectDefs(node.namedChild(i)!, name, out);
  }
};

/** A signature for a C-implemented (doc-only) method, synthesized ONLY when
 * unambiguous: exactly one `def NAME …` across the section's code fences.
 * Ambiguity (zero, or several disagreeing defs) yields null — the doc still
 * rides completion/hover, but a synthesized signature would drive arity/kwarg
 * diagnostics, so we stay silent unless certain (principle 2). */
export function docOnlySignature(
  ruby: Ruby,
  body: string[],
  name: string,
): { params: Param[]; signature: string } | null {
  const defs: Node[] = [];
  for (const fence of codeFences(body)) {
    if (!new RegExp(`\\bdef\\s+${escapeRe(name)}\\b`).test(fence)) continue;
    collectDefs(ruby.parse(fence).rootNode, name, defs);
  }
  if (defs.length !== 1) return null;
  const params = extractParams(defs[0]);
  return { params, signature: renderSignature(name, params) };
}

const escapeRe = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
