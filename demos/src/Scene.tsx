import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";

import { theme } from "./theme.ts";
import { Terminal } from "./Terminal.tsx";
import type { Timeline } from "./timeline.ts";

/**
 * The shared branded scene: dotted background, drenv wordmark, the animated
 * terminal, and a phase caption that changes with the active command.
 * `captions` maps a command's text to the caption shown while it's on screen.
 */
export const Scene: React.FC<{
  timeline: Timeline;
  captions: Record<string, string>;
  terminalTitle?: string;
}> = ({ timeline, captions, terminalTitle }) => {
  const frame = useCurrentFrame();

  const phases = timeline.lines
    .filter((line) => line.kind === "command" && captions[line.text])
    .map((line) => ({ start: line.start, caption: captions[line.text] }));

  const active = [...phases].reverse().find((p) => frame >= p.start);
  const captionOpacity = active
    ? interpolate(frame, [active.start, active.start + 12], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
    : 0;

  return (
    <AbsoluteFill style={{ background: theme.bg }}>
      <AbsoluteFill
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.06) 1.6px, transparent 0)",
          backgroundSize: "34px 34px",
          maskImage:
            "radial-gradient(120% 90% at 50% 40%, black 55%, transparent 100%)",
        }}
      />

      <AbsoluteFill
        style={{ alignItems: "center", justifyContent: "flex-start", paddingTop: 72 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Img src={staticFile("icon.png")} style={{ width: 44, height: 44 }} />
          <span
            style={{
              fontFamily: theme.sans,
              fontSize: 40,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              color: "#fff",
            }}
          >
            drenv
          </span>
          <span
            style={{
              marginLeft: 4,
              padding: "3px 12px",
              borderRadius: 999,
              background: "rgba(244,63,94,0.15)",
              color: theme.rose,
              fontFamily: theme.sans,
              fontSize: 17,
              letterSpacing: "1px",
              fontWeight: 500,
            }}
          >
            BETA
          </span>
        </div>
      </AbsoluteFill>

      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <Terminal lines={timeline.lines} title={terminalTitle} />
      </AbsoluteFill>

      <AbsoluteFill
        style={{ alignItems: "center", justifyContent: "flex-end", paddingBottom: 92 }}
      >
        <div
          style={{
            opacity: captionOpacity,
            fontFamily: theme.sans,
            fontSize: 44,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            color: "#fff",
          }}
        >
          {active?.caption ?? ""}
        </div>
      </AbsoluteFill>

      <AbsoluteFill
        style={{ alignItems: "center", justifyContent: "flex-end", paddingBottom: 44 }}
      >
        <span style={{ fontFamily: theme.sans, fontSize: 22, color: theme.faint }}>
          drenv.org
        </span>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
