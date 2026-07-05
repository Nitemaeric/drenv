import React from "react";

import { Scene } from "./Scene.tsx";
import { buildTimeline, type ScriptLine } from "./timeline.ts";

const SCRIPT: ScriptLine[] = [
  { kind: "command", text: "drenv install" },
  { kind: "output", text: "⟳ Downloading DragonRuby 7.11…", tone: "muted" },
  { kind: "output", text: "✔ drenv: Installed 7.11", tone: "green", hold: 26 },
  { kind: "command", text: "drenv new my-game" },
  { kind: "output", text: "drenv: Created my-game (7.11)", tone: "green", hold: 26 },
  { kind: "command", text: "cd my-game" },
  { kind: "command", text: "drenv run" },
  { kind: "output", text: "⟳ Bundling dependencies…", tone: "muted" },
  { kind: "output", text: "▸ Launching DragonRuby 7.11", tone: "rose", hold: 30 },
];

const CAPTIONS: Record<string, string> = {
  "drenv install": "Install DragonRuby",
  "drenv new my-game": "Scaffold a project",
  "drenv run": "Run your game",
};

export const quickStartTimeline = buildTimeline(SCRIPT);

export const QuickStart: React.FC = () => (
  <Scene timeline={quickStartTimeline} captions={CAPTIONS} />
);
