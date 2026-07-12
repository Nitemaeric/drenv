import type { Pos } from "../types.ts";
import type { Ctx } from "./ctx.ts";

const lineUpTo = (ctx: Ctx, uri: string, pos: Pos): string => {
  const text = ctx.ws.fileText(uri) ?? "";
  const line = text.split("\n")[pos.line] ?? "";
  return line.slice(0, pos.character);
};

export const completion = (ctx: Ctx, uri: string, pos: Pos): unknown[] => {
  const prefix = lineUpTo(ctx, uri, pos);
  const chain = prefix.match(/([A-Za-z_][\w.]*)\.\s*[\w]*$/)?.[1];

  if (chain) {
    const entries = ctx.engine.api.get(chain);
    if (entries) {
      return entries.map((e) => ({
        label: e.label,
        kind: 2, // Method
        detail: e.signature,
        documentation: { kind: "markdown", value: e.doc },
      }));
    }
  }

  const cls = ctx.engine.literalClass(prefix);
  if (cls) {
    const docs = ctx.engine.methodDocs(cls);
    const labels = new Set(ctx.engine.coreMethods(cls) ?? []);
    for (const name of docs?.keys() ?? []) labels.add(name);
    return [...labels].map((label) => ({
      label,
      kind: 2, // Method
      documentation: {
        kind: "markdown",
        value: docs?.get(label) ?? `mruby \`${cls}#${label}\``,
      },
    }));
  }

  // Fall back to workspace definitions + engine top-levels. Docs attach only
  // when unambiguous (same-named defs can document different things).
  const items: unknown[] = [...ctx.ws.defs.entries()].map(([name, locs]) => {
    const docs = [...new Set(locs.map((l) => l.doc).filter(Boolean))];
    const documented = locs.find((l) => l.doc);
    return {
      label: name,
      kind: 3, // Function
      ...(docs.length === 1
        ? {
          documentation: {
            kind: "markdown",
            value: ctx.yard.render(docs[0]!, documented?.container ?? ""),
          },
        }
        : {}),
    };
  });
  for (const mod of ["Geometry", "Easing"]) {
    if (ctx.engine.api.has(mod)) items.push({ label: mod, kind: 9 }); // Module
  }
  return items;
};
