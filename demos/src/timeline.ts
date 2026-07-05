import type { Tone } from "./theme.ts";

export const FPS = 30;

// Pacing (in frames @ 30fps).
export const FRAMES_PER_CHAR = 2.4; // ~12 chars/sec typing
const COMMAND_HOLD = 16; // pause after a command finishes typing ("runs")
const OUTPUT_FADE = 7; // fade-in for an output line
const OUTPUT_HOLD = 15; // pause after an output line appears
const LEAD_IN = 14; // blank frames before the first line
const END_HOLD = 45; // hold on the final frame

export type ScriptLine =
  | { kind: "command"; text: string; hold?: number }
  | { kind: "output"; text: string; tone?: Tone; hold?: number };

export type TimedLine = ScriptLine & { start: number; typeEnd: number };

export type Timeline = {
  lines: TimedLine[];
  durationInFrames: number;
};

/** Assigns each script line a start/typeEnd frame and totals the duration. */
export const buildTimeline = (script: ScriptLine[]): Timeline => {
  let cursor = LEAD_IN;
  const lines: TimedLine[] = [];

  for (const line of script) {
    const start = cursor;

    if (line.kind === "command") {
      const typeEnd = start + Math.ceil(line.text.length * FRAMES_PER_CHAR);
      cursor = typeEnd + (line.hold ?? COMMAND_HOLD);
      lines.push({ ...line, start, typeEnd });
    } else {
      const typeEnd = start + OUTPUT_FADE;
      cursor = typeEnd + (line.hold ?? OUTPUT_HOLD);
      lines.push({ ...line, start, typeEnd });
    }
  }

  return { lines, durationInFrames: Math.ceil(cursor + END_HOLD) };
};
