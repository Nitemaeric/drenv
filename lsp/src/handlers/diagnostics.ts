import type { Node } from "../ruby.ts";
import type { Param } from "../types.ts";
import { nodeRange } from "../analyze.ts";
import type { Ctx } from "./ctx.ts";

// --- performance hints (from the engine's troubleshoot-performance guide) ---

const MUTATORS = new Set([
  "delete",
  "delete_at",
  "delete_if",
  "push",
  "unshift",
  "pop",
  "shift",
  "clear",
  "concat",
  "insert",
  "reject!",
  "select!",
]);

const PERF_GUIDE =
  "https://docs.dragonruby.org/#/guides/troubleshoot-performance?id=array-manipulation";

// Flags mutation of a collection inside its own `.each` block — the guide's
// "Array Manipulation" antipattern (collect changes, apply after the loop).
const mutationDuringIteration = (node: Node, out: unknown[]) => {
  if (node.type !== "call") return;
  if (node.childForFieldName("method")?.text !== "each") return;
  const receiver = node.childForFieldName("receiver")?.text;
  const block = node.childForFieldName("block");
  if (!receiver || !block) return;

  const flag = (target: Node, how: string) =>
    out.push({
      range: nodeRange(target),
      severity: 3, // Information
      source: "drenv",
      code: "array-manipulation",
      codeDescription: { href: PERF_GUIDE },
      message:
        `\`${receiver}\` is ${how} while it's being iterated — collect ` +
        `changes and apply them after the loop (e.g. \`reject!\`). ` +
        `See: Troubleshoot Performance → Array Manipulation.`,
    });

  const scan = (n: Node) => {
    if (n.type === "call") {
      const method = n.childForFieldName("method");
      if (
        method && MUTATORS.has(method.text) &&
        n.childForFieldName("receiver")?.text === receiver
      ) {
        flag(n, `mutated (\`${method.text}\`)`);
      }
    }
    if (n.type === "binary") {
      const operator = n.childForFieldName("operator")?.text;
      if (operator === "<<" && n.childForFieldName("left")?.text === receiver) {
        flag(n, "appended to (`<<`)");
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) scan(n.namedChild(i)!);
  };
  scan(block);
};

export const diagnostics = (ctx: Ctx, uri: string): unknown[] => {
  const tree = ctx.ws.fileTree(uri);
  if (!tree) return [];
  const out: unknown[] = [];

  const visit = (node: Node) => {
    if (node.type === "ERROR" || node.isMissing) {
      out.push({
        range: nodeRange(node),
        severity: 1,
        source: "drenv",
        message: node.isMissing
          ? `syntax error: missing ${node.type}`
          : "syntax error",
      });
    }

    // Method validity — only asserted for receivers whose complete surface
    // we own (engine modules). `Array` etc. have core class methods beyond
    // the documented variants, so they get completions but never warnings.
    if (node.type === "call") {
      const receiver = node.childForFieldName("receiver");
      const method = node.childForFieldName("method");
      const known = receiver?.type === "constant" &&
        ctx.engine.validityReceivers.has(receiver.text) &&
        ctx.engine.api.get(receiver.text);
      if (known && method && !known.some((e) => e.label === method.text)) {
        out.push({
          range: nodeRange(method),
          severity: 2,
          source: "drenv",
          message: `\`${method.text}\` is not a method on ${
            receiver!.text
          } (DragonRuby ${ctx.engine.label})`,
        });
      } else if (known && method) {
        const entry = known.find((e) => e.label === method.text);
        const argsNode = node.childForFieldName("arguments");
        if (entry?.params && argsNode) {
          const all: Node[] = [];
          for (let i = 0; i < argsNode.namedChildCount; i++) {
            const child = argsNode.namedChild(i)!;
            if (child.type !== "block_argument") all.push(child);
          }

          const keywords = entry.params.filter((p) =>
            p.kind === "keyword" || p.kind === "keyword_optional"
          );
          const positionalParams = entry.params.filter((p) =>
            p.kind === "required" || p.kind === "optional" || p.kind === "rest"
          );

          // A hash-literal must carry the geometric attrs the engine's own
          // body reads off the parameter. Literals only — variables would
          // need type inference.
          const shapeCheck = (arg: Node, param: Param, where: string) => {
            if (arg.type !== "hash" || !param.shape) return;
            const keys = new Set<string>();
            let splat = false;
            for (let j = 0; j < arg.namedChildCount; j++) {
              const pair = arg.namedChild(j)!;
              if (pair.type !== "pair") {
                splat = true;
                break;
              }
              const key = pair.childForFieldName("key");
              if (key) keys.add(key.text.replace(/:$/, ""));
            }
            if (splat || keys.size === 0) return;
            const missing = param.shape.filter((attr) => !keys.has(attr));
            if (missing.length > 0) {
              out.push({
                range: nodeRange(arg),
                severity: 2,
                source: "drenv",
                message: `${where} (\`${param.name}\`) is missing ` +
                  missing.map((m) => `\`.${m}\``).join(", ") +
                  ` — ${receiver!.text}.${method.text} reads ` +
                  param.shape.map((s) => `${param.name}.${s}`).join(", "),
              });
            }
          };

          const arityError = (count: number) => {
            const required = positionalParams.filter((p) =>
              p.kind === "required"
            ).length;
            const hasRest = positionalParams.some((p) => p.kind === "rest");
            const max = hasRest ? Infinity : positionalParams.length;
            if (count >= required && count <= max) return;
            const expected = hasRest
              ? `at least ${required}`
              : required === positionalParams.length
              ? `${required}`
              : `${required}..${positionalParams.length}`;
            out.push({
              range: nodeRange(argsNode),
              severity: 2,
              source: "drenv",
              message: `${receiver!.text}.${method.text} expects ${expected} ` +
                `positional argument(s) — \`${entry.signature}\` — got ${count}`,
            });
          };

          if (keywords.length > 0) {
            // Bare pairs are kwargs: validate names, required presence, and
            // hash-literal values against the parameter's derived shape.
            const pairs = all.filter((c) => c.type === "pair");
            const positionalArgs = all.filter((c) => c.type !== "pair");
            const given = new Set<string>();

            for (const pair of pairs) {
              const key = pair.childForFieldName("key")?.text.replace(/:$/, "");
              if (!key) continue;
              given.add(key);
              const param = keywords.find((k) => k.name === key);
              if (!param) {
                out.push({
                  range: nodeRange(pair),
                  severity: 2,
                  source: "drenv",
                  message: `\`${key}:\` is not a keyword of ` +
                    `${receiver!.text}.${method.text} — accepted: ` +
                    keywords.map((k) => `${k.name}:`).join(", "),
                });
              } else {
                const value = pair.childForFieldName("value");
                if (value) shapeCheck(value, param, `keyword \`${key}:\``);
              }
            }

            const missingRequired = keywords.filter((k) =>
              k.kind === "keyword" && !given.has(k.name)
            );
            if (missingRequired.length > 0) {
              out.push({
                range: nodeRange(argsNode),
                severity: 2,
                source: "drenv",
                message: `${receiver!.text}.${method.text} is missing ` +
                  `required keyword(s) ` +
                  missingRequired.map((k) => `\`${k.name}:\``).join(", ") +
                  ` — \`${entry.signature}\``,
              });
            }

            arityError(positionalArgs.length);
          } else {
            // Contiguous trailing pairs collapse into one options hash.
            const children = [...all];
            while (
              children.length > 1 &&
              children[children.length - 1].type === "pair" &&
              children[children.length - 2].type === "pair"
            ) {
              children.pop();
            }
            const nonRest = positionalParams.filter((p) => p.kind !== "rest");
            for (let i = 0; i < children.length && i < nonRest.length; i++) {
              shapeCheck(children[i], nonRest[i], `argument ${i + 1}`);
            }
            arityError(children.length);
          }
        }
      }
    }

    mutationDuringIteration(node, out);

    for (let i = 0; i < node.namedChildCount; i++) visit(node.namedChild(i)!);
  };
  visit(tree.rootNode);
  return out;
};
