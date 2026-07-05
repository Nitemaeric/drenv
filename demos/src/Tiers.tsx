import React from "react";

import { Scene } from "./Scene.tsx";
import { buildTimeline, type ScriptLine } from "./timeline.ts";

const SCRIPT: ScriptLine[] = [
  { kind: "command", text: "drenv install --tier pro" },
  { kind: "output", text: "⟳ Fetching pro download…", tone: "muted" },
  { kind: "output", text: "✔ drenv: Installed 7.11-pro", tone: "green", hold: 24 },
  { kind: "command", text: "drenv versions" },
  { kind: "output", text: "  7.11 Pro", tone: "default" },
  { kind: "output", text: "  7.11 Indie", tone: "default" },
  { kind: "output", text: "* 7.11", tone: "default" },
  { kind: "output", text: "  6.4", tone: "default", hold: 32 },
  { kind: "command", text: "drenv use 7.11-pro" },
  { kind: "output", text: "drenv: Use version 7.11 Pro? Y/n (Y) Y", tone: "muted" },
  {
    kind: "output",
    text: "drenv: Now using version 7.11 Pro",
    tone: "green",
    hold: 32,
  },
];

const CAPTIONS: Record<string, string> = {
  "drenv install --tier pro": "Install any tier",
  "drenv versions": "Every tier, side by side",
  "drenv use 7.11-pro": "Switch per project",
};

export const tiersTimeline = buildTimeline(SCRIPT);

export const Tiers: React.FC = () => (
  <Scene timeline={tiersTimeline} captions={CAPTIONS} />
);
