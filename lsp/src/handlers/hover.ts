import { fromFileUrl } from "@std/path";

import { CORE_CLASSES, literalCoreClass } from "../resolve.ts";
import type { Def, Pos } from "../types.ts";
import type { Ctx } from "./ctx.ts";

export const hover = (ctx: Ctx, uri: string, pos: Pos): unknown => {
  const { ws, resolver, yard, engine } = ctx;
  const md = (value: string) => ({ contents: { kind: "markdown", value } });

  // Instance/class variables resolve by enclosing class, not by name.
  const nodeAt = ws.fileTree(uri)?.rootNode.descendantForPosition({
    row: pos.line,
    column: pos.character,
  });
  if (
    nodeAt &&
    (nodeAt.type === "instance_variable" || nodeAt.type === "class_variable")
  ) {
    const ns = resolver.enclosingNamespace(nodeAt);
    const kindLabel = nodeAt.type === "instance_variable"
      ? "instance variable"
      : "class variable";
    // A documented same-named attr_* in the same class is this variable's doc.
    const attr = (ws.defs.get(nodeAt.text.replace(/^@+/, "")) ?? []).find((f) =>
      f.container === ns && f.kind === "method" && f.doc
    );
    return md(
      `**${nodeAt.text}** — ${kindLabel}${ns ? ` of \`${ns}\`` : ""}` +
        (attr?.doc ? `\n\n---\n\n${yard.render(attr.doc, ns)}` : ""),
    );
  }

  const word = resolver.wordAt(uri, pos);
  if (!word) return null;

  // Engine API doc?
  const line = ws.fileText(uri)?.split("\n")[pos.line] ?? "";
  for (const [chain, entries] of engine.api) {
    const entry = entries.find((e) => e.label === word);
    if (entry && line.includes(`${chain.split(".").pop()}.${word}`)) {
      return md(
        `**${chain}.${word}** — DragonRuby ${engine.label}\n\n${entry.doc}`,
      );
    }
  }

  // Parameter or local variable of the enclosing method?
  const local = resolver.resolveLocal(uri, pos, word);
  if (local) {
    // A parameter's doc is its @param entry in the method's comment block.
    let paramDoc = "";
    if (local.role === "parameter") {
      const lines = (ws.fileText(uri) ?? "").split("\n");
      const raw: string[] = [];
      for (let r = local.method.startPosition.row - 1; r >= 0; r--) {
        const trimmed = lines[r].trim();
        if (!trimmed.startsWith("#")) break;
        raw.unshift(trimmed.replace(/^#[ ]?/, ""));
      }
      const rx = new RegExp(
        `^@param ${word}\\b\\s*(?:\\[([^\\]]*)\\])?\\s*(.*)$`,
      );
      for (let i = 0; i < raw.length; i++) {
        const m = raw[i].match(rx);
        if (!m) continue;
        const parts = [m[2] ?? ""];
        for (
          let j = i + 1;
          j < raw.length && raw[j].startsWith(" ") && !raw[j].startsWith("@");
          j++
        ) {
          parts.push(raw[j].trim());
        }
        const ns = resolver.enclosingNamespace(local.method);
        paramDoc = `\n\n---\n\n${
          m[1] ? `(${yard.renderType(m[1], ns)}) ` : ""
        }${yard.inlineMd(parts.join(" ").trim())}`;
        break;
      }
    }
    return md(
      `**${word}** — ${local.role} of \`${local.methodLabel}\`${paramDoc}`,
    );
  }

  // Receiver-typed method: when `word` is the method of a call `recv.word`,
  // type `recv` one hop and resolve `word` against that class — a literal/core
  // receiver borrows the engine's method docs; a workspace class pins the def.
  const call = nodeAt?.parent?.type === "call" &&
      nodeAt.parent.childForFieldName("method")?.id === nodeAt.id
    ? nodeAt.parent
    : null;
  const recv = call?.childForFieldName("receiver") ?? null;
  if (recv) {
    const cls = literalCoreClass(recv) ??
      resolver.receiverType(uri, recv)?.class;
    if (cls) {
      const doc = engine.methodDocs(cls)?.get(word);
      if (doc && CORE_CLASSES.has(cls)) {
        return md(`**${cls}#${word}** — DragonRuby ${engine.label}\n\n${doc}`);
      }
      if (!CORE_CLASSES.has(cls)) {
        const rel = (u: string) =>
          fromFileUrl(u).split("/").slice(-2).join("/");
        const chain = new Set(resolver.ancestors(cls));
        const inChain = (ws.defs.get(word) ?? []).filter((f) =>
          f.kind === "method" && chain.has(f.container ?? "")
        );
        const names = [...new Set(inChain.map((f) => qualifiedName(f, word)))];
        if (names.length === 1) {
          const files = [...new Set(inChain.map((f) => rel(f.uri)))];
          const documented = inChain.find((f) => f.doc);
          return md(
            `**${names[0]}** — defined in ${files.slice(0, 3).join(", ")}` +
              (documented?.doc
                ? `\n\n---\n\n${
                  yard.render(documented.doc, documented.container ?? "")
                }`
                : ""),
          );
        }
      }
    }
  }

  // Workspace definition?
  const found = ws.defs.get(word);
  if (found?.length) {
    const rel = (u: string) => fromFileUrl(u).split("/").slice(-2).join("/");
    const qualified = (f: Def) => qualifiedName(f, word);

    // Hovering the def itself pins down exactly which one it is.
    const at = found.find((f) =>
      f.uri === uri && f.range.start.line === pos.line &&
      pos.character >= f.range.start.character &&
      pos.character <= f.range.end.character
    );
    if (at) {
      return md(
        `**${qualified(at)}** — defined in ${rel(at.uri)}` +
          (at.doc
            ? `\n\n---\n\n${yard.render(at.doc, at.container ?? "")}`
            : ""),
      );
    }

    // A bare constant resolves by Ruby's lexical lookup (enclosing namespaces,
    // then top-level) — never an unrelated namespace that merely shares the
    // name. `Layout` inside `Main` sees `Main::Layout` / `::Layout`, not
    // `Conjuration::UI::Layout`.
    if (
      nodeAt?.type === "constant" && nodeAt.parent?.type !== "scope_resolution"
    ) {
      const def = resolver.resolveConst(
        word,
        resolver.enclosingNamespace(nodeAt),
      );
      if (!def) return null;
      const key = def.container ? `${def.container}::${word}` : word;
      return md(
        `**${key}** — defined in ${rel(def.uri)}` +
          (def.doc
            ? `\n\n---\n\n${yard.render(def.doc, def.container ?? "")}`
            : ""),
      );
    }

    // A bare call inside a class resolves like Ruby would: own class first,
    // then up the superclass chain, then same-file.
    let candidates = found;
    if (new Set(found.map(qualified)).size > 1) {
      candidates = resolver.contextCandidates(uri, pos, found) ?? found;
    }

    // One qualified name (possibly reopened across files): collapse.
    const names = [...new Set(candidates.map(qualified))];
    if (names.length === 1) {
      const files = [...new Set(candidates.map((f) => rel(f.uri)))];
      const where = files.slice(0, 3).join(", ") +
        (files.length > 3 ? ` (+${files.length - 3} more)` : "");
      const documented = candidates.find((f) => f.doc);
      const docs = [...new Set(candidates.map((f) => f.doc).filter(Boolean))];
      return md(
        `**${names[0]}** — defined in ${where}` +
          (docs.length === 1
            ? `\n\n---\n\n${yard.render(docs[0]!, documented?.container ?? "")}`
            : ""),
      );
    }

    // Ambiguous call site: list candidates instead of guessing a doc.
    const listed = candidates.slice(0, 5).map((f) =>
      `- \`${qualified(f)}\` — ${rel(f.uri)}`
    );
    const more = candidates.length > 5
      ? `\n- …and ${candidates.length - 5} more`
      : "";
    return md(
      `**${word}** — ${candidates.length} definitions\n\n${
        listed.join("\n")
      }${more}`,
    );
  }
  return null;
};

// `Class#method` for instance methods, `Class.method` for singletons (P3),
// `Namespace::Const` for classes/modules.
const qualifiedName = (f: Def, word: string): string => {
  if (!f.container) return word;
  if (f.kind === "method") {
    return `${f.container}${f.singleton ? "." : "#"}${word}`;
  }
  return `${f.container}::${word}`;
};
