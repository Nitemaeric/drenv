// The `args.*` chain tree, derived from the engine's own docs and runtime
// source (replaces the spike's curated ARGS_CHAINS). Chain keys come from the
// parenthetical annotations on markdown headings — `# Inputs (`args.inputs`)`,
// `## Mouse (`args.inputs.mouse`)` — and the single-hop `args.` members are the
// union of those md roots and the `GTK::Args` accessors/aliases in args.rb.

import { join } from "@std/path";

import type { ApiEntry } from "../types.ts";
import { firstProse, memberNames, parseHeadings } from "./md.ts";

// Their contents are runtime/user-defined (P5): they appear as `args.` members
// but expose no static sub-members, so we never emit a chain entry for them.
const NO_SUBMEMBERS = new Set([
  "args.state",
  "args.cvars",
  "args.pixel_arrays",
]);

const CHAIN_ANNOTATION = /\(`(args[^`]*)`\)/;

type MemberDocs = Map<string, string>; // member name -> doc (may be empty)

const parentOf = (chain: string): string => {
  const dot = chain.lastIndexOf(".");
  return dot < 0 ? "args" : chain.slice(0, dot);
};

const leafOf = (chain: string): string =>
  chain.slice(chain.lastIndexOf(".") + 1);

/** Expand the two variadic annotation forms shipped in the docs
 * (`controller_(one-four)`, `key_(down|up|held)`). An unrecognized parenthetical
 * keeps the literal token and logs — the derivation degrades, never guesses. */
export function expandChain(expr: string): string[] {
  const m = expr.match(/^(.*?)\(([^)]+)\)(.*)$/);
  if (!m) return [expr];
  const [, prefix, group, suffix] = m;
  let options: string[];
  if (group === "one-four") options = ["one", "two", "three", "four"];
  else if (group.includes("|")) options = group.split("|");
  else {
    console.error(`drenv lsp: unrecognized args chain annotation \`${expr}\``);
    return [expr];
  }
  return options.map((o) => `${prefix}${o}${suffix}`);
}

const readArgsAccessors = async (dir: string): Promise<string[]> => {
  let text: string;
  try {
    text = await Deno.readTextFile(
      join(dir, "docs", "oss", "dragon", "args.rb"),
    );
  } catch {
    return [];
  }
  const cls = text.split(/^\s*class Args\b/m)[1];
  if (!cls) return [];
  const body = cls.split(/^\s*(?:class|module)\b/m)[0];
  const names: string[] = [];
  for (const m of body.matchAll(/^\s*attr_accessor\s+:(\w+)/gm)) {
    names.push(m[1]);
  }
  for (const m of body.matchAll(/^\s*alias_method\s+:(\w+)\s*,/gm)) {
    names.push(m[1]);
  }
  return names;
};

/** All `args.*` chains keyed for `EngineIndex.api`. Every chain member is a
 * property (no signature/params); its doc is the first prose paragraph under
 * the member heading, else a generic fallback. */
export async function buildArgsChains(
  dir: string,
): Promise<Map<string, ApiEntry[]>> {
  const chains = new Map<string, MemberDocs>();
  const ensure = (key: string): MemberDocs => {
    let m = chains.get(key);
    if (!m) chains.set(key, m = new Map());
    return m;
  };
  const addMember = (chain: string, name: string, doc: string): void => {
    const m = ensure(chain);
    if (!m.has(name) || (doc && !m.get(name))) m.set(name, doc);
  };

  ensure("args");
  for (const name of await readArgsAccessors(dir)) addMember("args", name, "");

  let apiDir: string;
  try {
    apiDir = join(dir, "docs", "api");
    await Deno.stat(apiDir);
  } catch {
    return finalize(chains);
  }

  const files: string[] = [];
  for await (const e of Deno.readDir(apiDir)) {
    if (e.isFile && e.name.endsWith(".md")) files.push(e.name);
  }
  files.sort();

  for (const file of files) {
    const text = await Deno.readTextFile(join(apiDir, file));
    let current: string[] = []; // innermost open chain(s); [] outside any chain
    for (const h of parseHeadings(text)) {
      const ann = h.text.match(CHAIN_ANNOTATION);
      if (ann) {
        const keys = expandChain(ann[1]);
        const prose = firstProse(h.body);
        current = [];
        for (const key of keys) {
          addMember(parentOf(key), leafOf(key), prose);
          if (NO_SUBMEMBERS.has(key)) continue;
          ensure(key);
          current.push(key);
        }
        continue;
      }
      if (current.length === 0) continue;
      const doc = firstProse(h.body);
      for (const name of memberNames(h.text)) {
        if (name === "args") continue; // a dotted `args.x.y` token's leading id
        for (const key of current) addMember(key, name, doc);
      }
    }
  }

  return finalize(chains);
}

const finalize = (chains: Map<string, MemberDocs>): Map<string, ApiEntry[]> => {
  const out = new Map<string, ApiEntry[]>();
  for (const [chain, members] of chains) {
    if (members.size === 0) continue;
    out.set(
      chain,
      [...members].map(([label, doc]) => ({
        label,
        doc: doc || `DragonRuby \`${chain}.${label}\``,
      })),
    );
  }
  return out;
};
