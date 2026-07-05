import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";

import { theme } from "./theme.ts";
import { Scene } from "./Scene.tsx";
import { buildTimeline, type ScriptLine } from "./timeline.ts";

const TITLE = 75;
const END = 110;
const TRANS = 16;
const SEG_END_HOLD = 10;

// --- Condensed segments ------------------------------------------------------

const installTimeline = buildTimeline([
  { kind: "command", text: "drenv install" },
  { kind: "output", text: "✔ drenv: Installed 7.11", tone: "green", hold: 16 },
  { kind: "command", text: "drenv new my-game" },
  { kind: "output", text: "drenv: Created my-game (7.11)", tone: "green", hold: 16 },
  { kind: "command", text: "drenv run" },
  { kind: "output", text: "▸ Launching DragonRuby 7.11", tone: "rose", hold: 22 },
] satisfies ScriptLine[], { endHold: SEG_END_HOLD });

const depsTimeline = buildTimeline([
  { kind: "command", text: "drenv add github:Nitemaeric/conjuration" },
  { kind: "output", text: "drenv: added conjuration", tone: "green", hold: 16 },
  { kind: "command", text: "drenv update" },
  { kind: "output", text: "drenv: updated", tone: "muted" },
  { kind: "output", text: "  conjuration  a1b2c3d → f4e5d6c", tone: "green", hold: 22 },
] satisfies ScriptLine[], { endHold: SEG_END_HOLD });

const tiersTimeline = buildTimeline([
  { kind: "command", text: "drenv install --tier pro" },
  { kind: "output", text: "✔ drenv: Installed 7.11-pro", tone: "green", hold: 16 },
  { kind: "command", text: "drenv versions" },
  { kind: "output", text: "  7.11 Pro", tone: "default" },
  { kind: "output", text: "  7.11 Indie", tone: "default" },
  { kind: "output", text: "* 7.11", tone: "default", hold: 22 },
] satisfies ScriptLine[], { endHold: SEG_END_HOLD });

const C_INSTALL = { "drenv install": "Zero to running game" };
const C_DEPS = {
  "drenv add github:Nitemaeric/conjuration": "Bundler-style dependencies",
};
const C_TIERS = { "drenv install --tier pro": "Standard, indie & pro" };

export const sizzleDurationInFrames = TITLE + installTimeline.durationInFrames +
  depsTimeline.durationInFrames + tiersTimeline.durationInFrames + END -
  4 * TRANS;

// --- Bookend cards -----------------------------------------------------------

const Dots: React.FC = () => (
  <AbsoluteFill
    style={{
      backgroundImage:
        "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.06) 1.6px, transparent 0)",
      backgroundSize: "34px 34px",
      maskImage:
        "radial-gradient(120% 90% at 50% 45%, black 55%, transparent 100%)",
    }}
  />
);

const TitleCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 22 });
  const opacity = interpolate(frame, [0, 14], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill
      style={{ background: theme.bg, alignItems: "center", justifyContent: "center" }}
    >
      <Dots />
      <div
        style={{
          opacity,
          transform: `scale(${interpolate(enter, [0, 1], [0.94, 1])})`,
          textAlign: "center",
        }}
      >
        <Img
          src={staticFile("icon.png")}
          style={{ width: 96, height: 96, margin: "0 auto 26px" }}
        />
        <div
          style={{
            fontFamily: theme.sans,
            fontSize: 128,
            fontWeight: 600,
            letterSpacing: "-0.05em",
            color: "#fff",
            lineHeight: 1,
          }}
        >
          drenv
        </div>
        <div
          style={{
            marginTop: 18,
            fontFamily: theme.sans,
            fontSize: 40,
            color: theme.muted,
          }}
        >
          The DragonRuby Environment Manager
        </div>
      </div>
    </AbsoluteFill>
  );
};

const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 14], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill
      style={{ background: theme.bg, alignItems: "center", justifyContent: "center" }}
    >
      <Dots />
      <div style={{ opacity, textAlign: "center" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            justifyContent: "center",
            marginBottom: 30,
          }}
        >
          <Img src={staticFile("icon.png")} style={{ width: 64, height: 64 }} />
          <span
            style={{
              fontFamily: theme.sans,
              fontSize: 76,
              fontWeight: 600,
              letterSpacing: "-0.04em",
              color: "#fff",
            }}
          >
            drenv
          </span>
        </div>
        <div
          style={{
            display: "inline-block",
            border: `1px solid ${theme.border}`,
            background: theme.panel,
            borderRadius: 14,
            padding: "18px 30px",
            fontFamily: theme.mono,
            fontSize: 32,
            color: theme.rose,
          }}
        >
          curl -fsSL drenv.org/install.sh | bash
        </div>
        <div
          style={{
            marginTop: 24,
            fontFamily: theme.sans,
            fontSize: 26,
            color: theme.faint,
          }}
        >
          drenv.org
        </div>
      </div>
    </AbsoluteFill>
  );
};

// --- Reel --------------------------------------------------------------------

const trans = () => (
  <TransitionSeries.Transition
    presentation={fade()}
    timing={linearTiming({ durationInFrames: TRANS })}
  />
);

export const Sizzle: React.FC = () => (
  <AbsoluteFill style={{ background: theme.bg }}>
    <TransitionSeries>
      <TransitionSeries.Sequence durationInFrames={TITLE}>
        <TitleCard />
      </TransitionSeries.Sequence>
      {trans()}
      <TransitionSeries.Sequence durationInFrames={installTimeline.durationInFrames}>
        <Scene timeline={installTimeline} captions={C_INSTALL} />
      </TransitionSeries.Sequence>
      {trans()}
      <TransitionSeries.Sequence durationInFrames={depsTimeline.durationInFrames}>
        <Scene
          timeline={depsTimeline}
          captions={C_DEPS}
          terminalTitle="~/games/my-game — drenv"
        />
      </TransitionSeries.Sequence>
      {trans()}
      <TransitionSeries.Sequence durationInFrames={tiersTimeline.durationInFrames}>
        <Scene timeline={tiersTimeline} captions={C_TIERS} />
      </TransitionSeries.Sequence>
      {trans()}
      <TransitionSeries.Sequence durationInFrames={END}>
        <EndCard />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  </AbsoluteFill>
);
