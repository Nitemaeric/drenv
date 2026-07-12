import type { Workspace } from "../workspace.ts";
import type { Resolver } from "../resolve.ts";
import type { YardRenderer } from "../yard.ts";
import type { EngineIndex } from "../engine.ts";

export type Ctx = {
  ws: Workspace;
  resolver: Resolver;
  yard: YardRenderer;
  engine: EngineIndex;
};
