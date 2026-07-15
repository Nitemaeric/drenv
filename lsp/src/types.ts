export type Pos = { line: number; character: number };
export type Range = { start: Pos; end: Pos };
export type Loc = { uri: string; range: Range };

/** A workspace definition. */
export type Def = Loc & {
  container?: string; // enclosing namespace, "Conjuration::Animation"
  kind?: "method" | "class" | "module";
  doc?: string; // raw comment block, rendered lazily
  superclass?: string; // as written at the class site
  singleton?: boolean; // P3: `def self.x` — display `Class.x`, not `Class#x`
  includes?: string[]; // module names from `include X` in this body, as written
  extends?: string[]; // module names from `extend X` in this body, as written
};

export type Param = {
  label: string;
  name: string;
  kind: "required" | "optional" | "rest" | "keyword" | "keyword_optional";
  /** Geometric attrs the engine's own body reads off this parameter. */
  shape?: string[];
};

export type ApiEntry = {
  label: string;
  doc: string;
  params?: Param[];
  signature?: string;
};

export interface ConstResolver {
  resolveConst(path: string, container: string): Def | null;
  resolveConstName(path: string, container: string): string | null;
}
