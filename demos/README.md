# drenv demos

Branded demo videos for drenv, built with [Remotion](https://www.remotion.dev)
(programmatic video in React).

> [!NOTE]
> Remotion is free for individuals and small teams but requires a paid company
> license above a small headcount — see
> [remotion.dev/license](https://www.remotion.dev/license).

## Setup

```sh
cd demos
npm install
```

## Preview

```sh
npm run studio      # opens the Remotion Studio to scrub/preview compositions
```

## Render

```sh
npm run render      # → out/quick-start.mp4
npm run render:gif  # → out/quick-start.gif
```

## Layout

- `src/QuickStart.tsx` — the quick-start flow (`install → new → run`)
- `src/Terminal.tsx` — the animated fake-terminal component (typed commands,
  revealed output), reused across demos
- `src/timeline.ts` — turns a command script into frame timings
- `src/theme.ts` — palette matching drenv.org
- `public/icon.png` — the drenv mark

Add a new demo by writing a `ScriptLine[]`, building a composition like
`QuickStart`, and registering it in `src/Root.tsx`.
