import React from "react";

import { Scene } from "./Scene.tsx";
import { buildTimeline, type ScriptLine } from "./timeline.ts";

const SCRIPT: ScriptLine[] = [
  { kind: "command", text: "drenv add github:Nitemaeric/conjuration" },
  { kind: "output", text: "drenv: added conjuration", tone: "green" },
  { kind: "output", text: "add to the top of mygame/app/main.rb:", tone: "muted" },
  { kind: "output", text: "  require 'app/drenv_bundle.rb'", tone: "rose", hold: 30 },
  { kind: "command", text: "drenv list" },
  {
    kind: "output",
    text: "conjuration  github:Nitemaeric/conjuration  a1b2c3d",
    tone: "default",
    hold: 26,
  },
  { kind: "command", text: "drenv outdated" },
  { kind: "output", text: "conjuration  a1b2c3d → f4e5d6c", tone: "rose", hold: 26 },
  { kind: "command", text: "drenv update conjuration" },
  { kind: "output", text: "drenv: updated", tone: "muted" },
  { kind: "output", text: "  conjuration  a1b2c3d → f4e5d6c", tone: "green", hold: 32 },
];

const CAPTIONS: Record<string, string> = {
  "drenv add github:Nitemaeric/conjuration": "Declare a dependency",
  "drenv list": "Locked & reproducible",
  "drenv outdated": "Spot upstream changes",
  "drenv update conjuration": "Bump to the latest",
};

export const dependenciesTimeline = buildTimeline(SCRIPT);

export const Dependencies: React.FC = () => (
  <Scene
    timeline={dependenciesTimeline}
    captions={CAPTIONS}
    terminalTitle="~/games/my-game — drenv"
  />
);
