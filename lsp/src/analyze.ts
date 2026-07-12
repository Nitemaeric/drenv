import type { Node } from "./ruby.ts";
import type { Param, Range } from "./types.ts";

// Only geometric attrs count toward a duck shape, so incidental calls the
// body makes on a param (.merge, .to_radians, ...) don't produce demands.
export const GEOM_ATTRS = new Set([
  "x",
  "y",
  "w",
  "h",
  "x2",
  "y2",
  "r",
  "radius",
  "cx",
  "cy",
  "anchor_x",
  "anchor_y",
]);

export const nodeRange = (node: Node): Range => ({
  start: { line: node.startPosition.row, character: node.startPosition.column },
  end: { line: node.endPosition.row, character: node.endPosition.column },
});

export const extractParams = (method: Node): Param[] => {
  const parameters = method.childForFieldName("parameters");
  if (!parameters) return [];

  const params: Param[] = [];
  const named = (child: Node) =>
    child.childForFieldName("name")?.text ?? child.text;

  for (let i = 0; i < parameters.namedChildCount; i++) {
    const child = parameters.namedChild(i)!;
    switch (child.type) {
      case "identifier":
        params.push({ label: child.text, name: child.text, kind: "required" });
        break;
      case "optional_parameter":
        params.push({
          label: child.text,
          name: named(child),
          kind: "optional",
        });
        break;
      case "keyword_parameter":
        params.push({
          label: child.text,
          name: named(child),
          // A keyword without a default is required at the call site.
          kind: child.childForFieldName("value")
            ? "keyword_optional"
            : "keyword",
        });
        break;
      case "splat_parameter":
      case "hash_splat_parameter":
        params.push({ label: child.text, name: named(child), kind: "rest" });
        break;
        // block parameters aren't part of the positional signature
    }
  }

  deriveShapes(method, params);
  return params;
};

/** Collects the geometric attrs the method body reads off each parameter. */
const deriveShapes = (method: Node, params: Param[]) => {
  const body = method.childForFieldName("body");
  if (!body) return;

  const byName = new Map(params.map((p) => [p.name, new Set<string>()]));
  const reassigned = new Set<string>();

  const scan = (n: Node) => {
    if (n.type === "assignment") {
      const left = n.childForFieldName("left");
      if (left?.type === "identifier") reassigned.add(left.text);
    }
    if (n.type === "call") {
      const receiver = n.childForFieldName("receiver");
      const attr = n.childForFieldName("method");
      const argsNode = n.childForFieldName("arguments");
      if (
        receiver?.type === "identifier" && byName.has(receiver.text) &&
        attr && GEOM_ATTRS.has(attr.text) &&
        (!argsNode || argsNode.namedChildCount === 0)
      ) {
        byName.get(receiver.text)!.add(attr.text);
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) scan(n.namedChild(i)!);
  };
  scan(body);

  for (const param of params) {
    const attrs = byName.get(param.name);
    if (attrs?.size && !reassigned.has(param.name)) {
      param.shape = [...attrs].sort();
    }
  }
};

export const renderSignature = (name: string, params: Param[]): string =>
  `${name}(${params.map((p) => p.label).join(", ")})`;
