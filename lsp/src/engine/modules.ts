// Runtime modules (Geometry, Easing) parsed from the engine's own Ruby source
// (`docs/oss/dragon/*.rb`): every non-underscore `def` becomes an entry with
// classified params, a rendered signature, derived duck shapes, and the
// contiguous `#` comment block above it as its doc. These are the only receivers
// whose full method surface the engine owns — hence the sole validity receivers.

import { join } from "@std/path";

import type { Node, Ruby } from "../ruby.ts";
import type { ApiEntry } from "../types.ts";
import { extractParams, renderSignature } from "../analyze.ts";

export async function buildModule(
  ruby: Ruby,
  dir: string,
  file: string,
): Promise<ApiEntry[]> {
  let text: string;
  try {
    text = await Deno.readTextFile(join(dir, "docs", "oss", "dragon", file));
  } catch {
    return [];
  }

  const entries: ApiEntry[] = [];
  const visit = (node: Node) => {
    if (node.type === "method") {
      const method = node.childForFieldName("name")?.text;
      if (method && !method.startsWith("_")) {
        const docLines: string[] = [];
        let prev = node.previousNamedSibling;
        while (prev?.type === "comment") {
          docLines.unshift(prev.text.replace(/^#\s?/, ""));
          prev = prev.previousNamedSibling;
        }
        const params = extractParams(node);
        entries.push({
          label: method,
          doc: docLines.join("\n"),
          params,
          signature: renderSignature(method, params),
        });
      }
    }
    for (let i = 0; i < node.namedChildCount; i++) visit(node.namedChild(i)!);
  };
  visit(ruby.parse(text).rootNode);

  return entries;
}
