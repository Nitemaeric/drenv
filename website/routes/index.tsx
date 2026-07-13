import Nav from "../components/Nav.tsx";
import Footer from "../components/Footer.tsx";
import Terminal from "../components/Terminal.tsx";
import InstallCommand from "../islands/InstallCommand.tsx";
import { defineRoute } from "$fresh/server.ts";
import { latestVersion } from "../utils/version.ts";

const QUICK_START: [string, string?][] = [
  ["drenv install", "     # download DragonRuby (asks which tier you own)"],
  ["drenv new my-game", " # scaffold a project on that version"],
  ["cd my-game"],
  ["drenv run", "         # launch it"],
];

const FEATURES = [
  {
    title: "Every tier, side by side",
    desc:
      "Standard from itch.io, indie and pro from dragonruby.org. Install them all — they coexist, and each project picks the one it needs.",
  },
  {
    title: "Projects in one command",
    desc:
      "drenv new scaffolds a game on your newest install. drenv use switches it, drenv run launches it — dependencies and all.",
  },
  {
    title: "Dependencies, vendored",
    desc:
      "Declare libraries in drenv.toml and drenv resolves, locks, and vendors them into your game — reproducibly, Bundler-style.",
  },
];

export default defineRoute(async () => {
  const version = await latestVersion();
  return (
    <div class="bg-zinc-950 text-white">
      <Nav />

      {/* Hero */}
      <section class="relative flex min-h-[calc(100dvh-65px)] flex-col overflow-hidden bg-zinc-950">
        <div class="hero-texture absolute inset-0 z-0" aria-hidden="true" />

        <div class="relative z-10 flex flex-1 items-center justify-center px-6 py-20">
          <div class="max-w-2xl text-center">
            <div class="mb-6 flex justify-center">
              <img
                src="/icon.png"
                alt="DragonRuby"
                class="h-[64px] w-[64px] opacity-90"
              />
            </div>

            <h1 class="mb-3 text-[92px] font-semibold leading-[0.82] tracking-[-5.5px] text-white sm:text-[110px]">
              drenv
            </h1>

            <p class="mb-4 text-2xl tracking-tight text-white/75">
              The DragonRuby Environment Manager
            </p>

            <p class="mx-auto mb-8 max-w-lg text-white/55">
              Install DragonRuby, manage versions and tiers, scaffold projects,
              and vendor your game's dependencies — one small, fast CLI.
            </p>

            <InstallCommand version={version} />
          </div>
        </div>

        <a
          href="#about"
          class="group absolute bottom-10 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center text-white/40 transition-colors hover:text-white/70"
          aria-label="Scroll to learn more"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-5 w-5 transition-transform group-hover:translate-y-0.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2.25"
              d="M19 14l-7 7m0 0l-7-7m7 7V3"
            />
          </svg>
        </a>
      </section>

      {/* Demo reel */}
      <section class="mx-auto max-w-4xl px-6 pt-24 pb-8">
        <div class="mb-8 text-center">
          <div class="mb-3 text-xs tracking-[3px] text-rose-500">
            SEE IT IN ACTION
          </div>
          <h2 class="text-4xl font-semibold tracking-tight">
            One CLI, from install to ship.
          </h2>
        </div>
        <div class="overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl">
          <video
            src="/sizzle.mp4"
            poster="/sizzle-poster.png"
            autoplay
            muted
            loop
            playsinline
            controls
            class="block h-auto w-full"
          />
        </div>
      </section>

      {/* What is drenv */}
      <section
        id="about"
        class="mx-auto max-w-3xl px-6 pb-24 pt-20 text-center"
      >
        <div class="mb-3 text-xs tracking-[3px] text-rose-500">
          SIMPLE. RELIABLE. FAMILIAR.
        </div>
        <h2 class="mb-6 text-4xl font-semibold tracking-tight">
          Everything around your <span class="text-white/90">DragonRuby</span>
          {" "}
          game.
        </h2>
        <p class="mx-auto max-w-2xl text-lg leading-relaxed text-white/70">
          drenv is inspired by rbenv and Bundler. It keeps your DragonRuby
          installs tidy, your projects reproducible, and your dependencies
          vendored — on macOS, Linux, and Windows.
        </p>

        <div class="mt-10 grid grid-cols-1 gap-4 text-left sm:grid-cols-3">
          {FEATURES.map((f) => (
            <div class="rounded-xl border border-white/10 bg-zinc-900/50 p-6">
              <div class="mb-2 font-semibold">{f.title}</div>
              <div class="text-sm leading-snug text-white/60">{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Dependencies showcase */}
      <section class="mx-auto max-w-3xl border-t border-white/10 px-6 pb-24 pt-16">
        <div class="mb-3 text-center text-xs tracking-[3px] text-rose-500">
          BUNDLER, FOR DRAGONRUBY
        </div>
        <h2 class="mb-4 text-center text-4xl font-semibold tracking-tight">
          Dependencies that just work.
        </h2>
        <p class="mx-auto mb-10 max-w-2xl text-center text-lg leading-relaxed text-white/70">
          Declare a library, and drenv resolves it, pins it in a lockfile, and
          vendors it into your game. Commit the lockfile; everyone builds the
          exact same thing.
        </p>

        <div class="space-y-4">
          <div class="rounded-xl border border-white/10 bg-zinc-900/60 p-6">
            <div class="mb-3 text-xs uppercase tracking-[2px] text-white/50">
              1 · Add a dependency
            </div>
            <Terminal lines={[["drenv add github:Nitemaeric/conjuration"]]} />
          </div>
          <div class="rounded-xl border border-white/10 bg-zinc-900/60 p-6">
            <div class="mb-3 text-xs uppercase tracking-[2px] text-white/50">
              2 · Require it once, at the top of{" "}
              <span class="normal-case text-white/60">mygame/app/main.rb</span>
            </div>
            <pre class="overflow-x-auto rounded-lg border border-white/10 bg-black px-5 py-4 font-mono text-sm text-emerald-300"><code>require 'app/drenv_bundle.rb'</code></pre>
          </div>
        </div>

        <p class="mt-6 text-center text-sm text-white/55">
          Then <code class="text-rose-400">drenv run</code>{" "}
          re-vendors everything and launches. Bump with{" "}
          <code class="text-rose-400">drenv update</code>, check with{" "}
          <code class="text-rose-400">drenv outdated</code>.
        </p>
      </section>

      {/* Quick start */}
      <section class="mx-auto max-w-3xl border-t border-white/10 px-6 pb-24 pt-16">
        <div class="mb-3 text-center text-xs tracking-[3px] text-rose-500">
          GET GOING
        </div>
        <h2 class="mb-10 text-center text-4xl font-semibold tracking-tight">
          Zero to running game.
        </h2>

        <Terminal lines={QUICK_START} />

        <div class="mt-10 text-center">
          <a
            href="/docs"
            class="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-medium text-zinc-950 transition-colors hover:bg-white/90"
          >
            Read the docs <span aria-hidden="true">→</span>
          </a>
        </div>
      </section>

      <Footer />
    </div>
  );
});
