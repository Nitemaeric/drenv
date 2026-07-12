import type { Node } from "../ruby.ts";
import type { Param } from "../types.ts";
import { nodeRange } from "../analyze.ts";
import {
  arrayPrimitivesRule,
  bulkConcatRule,
  mutationDuringIteration,
  recursionRule,
  type SeverityAt,
  tickReachability,
  unusedMapRule,
} from "../perf.ts";
import type { Ctx } from "./ctx.ts";

// Label keys (`anchor_x:`) surface without a colon; hash-rocket symbol keys
// (`:anchor_x =>`) carry a leading one. Strip both so lookups match param names.
const normKey = (text: string) => text.replace(/^:/, "").replace(/:$/, "");

const enclosingMethod = (node: Node): Node | null => {
  for (let p = node.parent; p; p = p.parent) {
    if (p.type === "method" || p.type === "singleton_method") return p;
  }
  return null;
};

export const diagnostics = (ctx: Ctx, uri: string): unknown[] => {
  const tree = ctx.ws.fileTree(uri);
  if (!tree) return [];
  const out: unknown[] = [];
  const severityAt: SeverityAt = tickReachability(ctx.ws);

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
          let hashSplat = false;
          for (let i = 0; i < argsNode.namedChildCount; i++) {
            const child = argsNode.namedChild(i)!;
            if (child.type === "block_argument") continue;
            // `**opts` forwards unknown keywords: it is neither positional nor
            // a checkable kwarg, so it suppresses both counts below.
            if (child.type === "hash_splat_argument") {
              hashSplat = true;
              continue;
            }
            all.push(child);
          }

          const keywords = entry.params.filter((p) =>
            p.kind === "keyword" || p.kind === "keyword_optional"
          );
          const positionalParams = entry.params.filter((p) =>
            p.kind === "required" || p.kind === "optional" || p.kind === "rest"
          );

          // A hash-literal must carry the geometric attrs the engine's own
          // body reads off the parameter. An identifier argument is resolved
          // through ONE hop to its same-method literal hash (unreassigned,
          // unmutated — resolver-gated) and checked exactly as if inline; any
          // other receiver-typing source stays out of diagnostics (principle 2).
          const callerMethod = enclosingMethod(node);
          const shapeCheck = (arg: Node, param: Param, where: string) => {
            if (!param.shape) return;
            let hash = arg;
            if (arg.type === "identifier") {
              const lit = callerMethod
                ? ctx.resolver.sameMethodLiteral(callerMethod, arg.text)
                : null;
              if (!lit) return;
              hash = lit;
            }
            if (hash.type !== "hash") return;
            const keys = new Set<string>();
            let splat = false;
            for (let j = 0; j < hash.namedChildCount; j++) {
              const pair = hash.namedChild(j)!;
              if (pair.type !== "pair") {
                splat = true;
                break;
              }
              const key = pair.childForFieldName("key");
              if (key) keys.add(normKey(key.text));
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
              const keyText = pair.childForFieldName("key")?.text;
              const key = keyText === undefined ? undefined : normKey(keyText);
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

            const missingRequired = hashSplat
              ? []
              : keywords.filter((k) =>
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
    arrayPrimitivesRule(node, out, severityAt);
    bulkConcatRule(node, out, severityAt);
    recursionRule(node, out, severityAt);
    unusedMapRule(node, out, severityAt);

    for (let i = 0; i < node.namedChildCount; i++) visit(node.namedChild(i)!);
  };
  visit(tree.rootNode);
  return out;
};
