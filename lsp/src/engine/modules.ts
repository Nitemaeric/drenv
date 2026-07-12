// Runtime modules (Geometry, Easing) parsed from the engine's own Ruby source
// (`docs/oss/dragon/*.rb`): every non-underscore `def` — whether `def foo` or
// `def self.foo`, declared directly in the file's own module — becomes an entry
// with classified params, a rendered signature, derived duck shapes, and the
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

  // The module this file defines, e.g. `easing.rb` → `Easing`. Methods are
  // gated on this so an incidental monkeypatch sharing the file (e.g.
  // `module Math; def self.pow` at the top of geometry.rb) isn't misattributed.
  const target = file
    .replace(/\.rb$/, "")
    .split("_")
    .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1))
    .join("");

  const entries: ApiEntry[] = [];
  const moduleStack: string[] = [];
  // Both plain `def foo` (`method`) and `def self.foo` (`singleton_method`)
  // expose the method surface — easing.rb declares every method as
  // `def self.x`, so limiting to `method` would drop the module entirely.
  const visit = (node: Node) => {
    if (node.type === "module") {
      moduleStack.push(node.childForFieldName("name")?.text ?? "");
    }
    if (node.type === "method" || node.type === "singleton_method") {
      const method = node.childForFieldName("name")?.text;
      const enclosing = moduleStack[moduleStack.length - 1];
      if (method && !method.startsWith("_") && enclosing === target) {
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
    if (node.type === "module") moduleStack.pop();
  };
  visit(ruby.parse(text).rootNode);

  return entries;
}
