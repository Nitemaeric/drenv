import React from "react";
import { Composition } from "remotion";

import { QuickStart, quickStartTimeline } from "./QuickStart.tsx";
import { Dependencies, dependenciesTimeline } from "./Dependencies.tsx";
import { Tiers, tiersTimeline } from "./Tiers.tsx";
import { Sizzle, sizzleDurationInFrames } from "./Sizzle.tsx";
import { FPS } from "./timeline.ts";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="QuickStart"
        component={QuickStart}
        durationInFrames={quickStartTimeline.durationInFrames}
        fps={FPS}
        width={1920}
        height={1080}
      />
      <Composition
        id="Dependencies"
        component={Dependencies}
        durationInFrames={dependenciesTimeline.durationInFrames}
        fps={FPS}
        width={1920}
        height={1080}
      />
      <Composition
        id="Tiers"
        component={Tiers}
        durationInFrames={tiersTimeline.durationInFrames}
        fps={FPS}
        width={1920}
        height={1080}
      />
      <Composition
        id="Sizzle"
        component={Sizzle}
        durationInFrames={sizzleDurationInFrames}
        fps={FPS}
        width={1920}
        height={1080}
      />
    </>
  );
};
