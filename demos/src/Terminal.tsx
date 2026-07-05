import React from "react";
import { interpolate, useCurrentFrame } from "remotion";

import { theme, toneColor } from "./theme.ts";
import { FRAMES_PER_CHAR, type TimedLine } from "./timeline.ts";

const Cursor: React.FC = () => {
  const frame = useCurrentFrame();
  const on = Math.floor(frame / 8) % 2 === 0;
  return (
    <span
      style={{
        display: "inline-block",
        width: "0.6em",
        height: "1.1em",
        marginLeft: 2,
        transform: "translateY(0.18em)",
        background: on ? theme.rose : "transparent",
        borderRadius: 1,
      }}
    />
  );
};

/** Renders a fake terminal window whose contents type/appear over time. */
export const Terminal: React.FC<{ lines: TimedLine[]; title?: string }> = ({
  lines,
  title = "~/games — drenv",
}) => {
  const frame = useCurrentFrame();
  const visible = lines.filter((line) => frame >= line.start);

  return (
    <div
      style={{
        width: 1180,
        borderRadius: 18,
        border: `1px solid ${theme.border}`,
        background: theme.panel,
        boxShadow: "0 40px 120px rgba(0,0,0,0.6)",
        overflow: "hidden",
      }}
    >
      {/* Window chrome */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "16px 20px",
          background: theme.chrome,
          borderBottom: `1px solid ${theme.border}`,
        }}
      >
        {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
          <div
            key={c}
            style={{ width: 13, height: 13, borderRadius: 999, background: c }}
          />
        ))}
        <div
          style={{
            flex: 1,
            textAlign: "center",
            marginRight: 39,
            color: theme.faint,
            fontFamily: theme.mono,
            fontSize: 20,
          }}
        >
          {title}
        </div>
      </div>

      {/* Body */}
      <div
        style={{
          padding: "28px 32px",
          minHeight: 440,
          fontFamily: theme.mono,
          fontSize: 30,
          lineHeight: 1.55,
        }}
      >
        {visible.map((line, i) => {
          if (line.kind === "command") {
            const chars = Math.max(
              0,
              Math.min(
                line.text.length,
                Math.floor((frame - line.start) / FRAMES_PER_CHAR),
              ),
            );
            const typing = frame < line.typeEnd;
            const isLast = i === visible.length - 1;
            return (
              <div key={i} style={{ color: theme.text, whiteSpace: "pre" }}>
                <span style={{ color: theme.rose }}>❯ </span>
                {line.text.slice(0, chars)}
                {(typing || isLast) && <Cursor />}
              </div>
            );
          }

          const opacity = interpolate(
            frame,
            [line.start, line.typeEnd],
            [0, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
          );
          return (
            <div
              key={i}
              style={{
                opacity,
                color: toneColor(line.tone),
                whiteSpace: "pre",
              }}
            >
              {line.text}
            </div>
          );
        })}
      </div>
    </div>
  );
};
