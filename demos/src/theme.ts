// Shared palette + type, matching drenv.org (dark zinc + rose accent).
export const theme = {
  bg: "#09090b", // zinc-950
  panel: "#000000",
  chrome: "#18181b", // zinc-900
  border: "rgba(255,255,255,0.10)",
  text: "rgba(255,255,255,0.90)",
  muted: "rgba(255,255,255,0.45)",
  faint: "rgba(255,255,255,0.30)",
  rose: "#fb7185", // rose-400
  roseDim: "#f43f5e",
  green: "#6ee7b7", // emerald-300
  mono:
    'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  sans:
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
} as const;

export type Tone = "default" | "muted" | "rose" | "green";

export const toneColor = (tone: Tone | undefined): string => {
  switch (tone) {
    case "muted":
      return theme.muted;
    case "rose":
      return theme.rose;
    case "green":
      return theme.green;
    default:
      return theme.text;
  }
};
