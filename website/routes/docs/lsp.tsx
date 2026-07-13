import { Head } from "$fresh/runtime.ts";
import type { ComponentChildren } from "preact";
import Nav from "../../components/Nav.tsx";
import Footer from "../../components/Footer.tsx";

function Editor(
  { file, children }: { file: string; children: ComponentChildren },
) {
  return (
    <div class="overflow-hidden rounded-xl border border-white/10 bg-black shadow-2xl shadow-black/50">
      <div class="flex items-center gap-1.5 border-b border-white/10 bg-zinc-900/80 px-4 py-2.5">
        <span class="h-2.5 w-2.5 rounded-full bg-white/15" />
        <span class="h-2.5 w-2.5 rounded-full bg-white/15" />
        <span class="h-2.5 w-2.5 rounded-full bg-white/15" />
        <span class="ml-2 font-mono text-xs text-white/40">{file}</span>
      </div>
      <div class="overflow-x-auto p-4 font-mono text-[13px] leading-6">
        {children}
      </div>
    </div>
  );
}

const Caret = () => (
  <span class="ml-px inline-block h-[15px] w-[2px] translate-y-[2px] animate-pulse bg-rose-400" />
);

const Wavy = (
  { children, color = "#fbbf24" }: {
    children: ComponentChildren;
    color?: string;
  },
) => (
  <span
    style={`text-decoration: underline wavy ${color}; text-decoration-thickness: 1px; text-underline-offset: 4px;`}
  >
    {children}
  </span>
);

type Item = { label: string; detail: string; selected?: boolean };
const COMPLETION_ITEMS: Item[] = [
  { label: "each", detail: "mruby core" },
  { label: "filter_map", detail: "Array — DragonRuby 7.13", selected: true },
  { label: "map_2d", detail: "Array — DragonRuby 7.13" },
  { label: "product", detail: "Array — DragonRuby 7.13" },
  { label: "reject", detail: "mruby core" },
];

function CompletionMock() {
  return (
    <Editor file="mygame/app/main.rb">
      <div>
        <span class="text-zinc-500">
          # the server knows enemies is an Array
        </span>
      </div>
      <div>
        <span class="text-zinc-100">enemies = []</span>
      </div>
      <div>
        <span class="text-zinc-100">enemies.fi</span>
        <Caret />
      </div>
      <div class="mt-1 w-72 max-w-full overflow-hidden rounded-lg border border-white/15 bg-zinc-900 shadow-xl">
        {COMPLETION_ITEMS.map((item) => (
          <div
            class={`flex items-center gap-2 px-3 py-1 ${
              item.selected ? "bg-rose-500/20" : ""
            }`}
          >
            <span class="flex h-4 w-4 items-center justify-center rounded bg-sky-500/20 text-[10px] text-sky-300">
              ƒ
            </span>
            <span class="text-zinc-100">{item.label}</span>
            <span class="ml-auto whitespace-nowrap text-[11px] text-white/35">
              {item.detail}
            </span>
          </div>
        ))}
      </div>
    </Editor>
  );
}

function HoverMock() {
  return (
    <Editor file="mygame/app/main.rb">
      <div class="mb-1 w-80 max-w-full rounded-lg border border-white/15 bg-zinc-900 p-3 text-[12px] leading-5 shadow-xl">
        <div>
          <span class="font-semibold text-zinc-100">Geometry.distance</span>
          <span class="text-white/45">{" — DragonRuby 7.13"}</span>
        </div>
        <div class="my-2 border-t border-white/10" />
        <div class="text-white/70">
          Returns the distance between two points.
        </div>
        <div class="mt-2 rounded bg-black px-2 py-1 text-emerald-300">
          distance(point_one, point_two)
        </div>
      </div>
      <div>
        <span class="text-zinc-100">dist ={" "}</span>
        <span class="text-rose-400">Geometry</span>
        <span class="text-zinc-100">.</span>
        <span class="rounded bg-white/10 px-0.5 text-sky-300">distance</span>
        <span class="text-zinc-100">({"{"} x: 0, y: 0 {"}"}, player)</span>
      </div>
    </Editor>
  );
}

function SignatureMock() {
  return (
    <Editor file="mygame/app/main.rb">
      <div class="mb-1 w-80 max-w-full rounded-lg border border-white/15 bg-zinc-900 p-3 text-[12px] leading-5 shadow-xl">
        <div class="text-zinc-100">
          rotate_point(point,{" "}
          <span class="rounded bg-rose-500/25 px-1 font-semibold text-rose-300">
            angle
          </span>, around = nil)
        </div>
        <div class="mt-1 text-white/55">
          angle — degrees to rotate point around
        </div>
      </div>
      <div>
        <span class="text-rose-400">Geometry</span>
        <span class="text-zinc-100">.</span>
        <span class="text-sky-300">rotate_point</span>
        <span class="text-zinc-100">({"{"} x: 0, y: 0 {"}"}, 90</span>
        <Caret />
      </div>
    </Editor>
  );
}

function DiagnosticsMock() {
  return (
    <Editor file="mygame/app/main.rb">
      <div>
        <span class="text-rose-400">Geometry</span>
        <span class="text-zinc-100">.</span>
        <Wavy>
          <span class="text-sky-300">nope</span>
        </Wavy>
        <span class="text-zinc-100">(args)</span>
      </div>
      <div>
        <span class="text-rose-400">Geometry</span>
        <span class="text-zinc-100">.</span>
        <span class="text-sky-300">rect_navigate</span>
        <span class="text-zinc-100">{" "}</span>
        <Wavy>
          <span class="text-zinc-100">rec:</span>
        </Wavy>
        <span class="text-zinc-100">{" {}"}</span>
      </div>
      <div class="mt-2 w-96 max-w-full rounded-lg border border-amber-400/30 bg-zinc-900 p-3 text-[12px] leading-5 shadow-xl">
        <div class="text-white/80">
          <span class="text-amber-300">⚠</span>{" "}
          <code class="text-rose-400">rec:</code>{" "}
          is not a keyword of Geometry.rect_navigate — accepted:{" "}
          <code class="text-rose-400">rect:</code>,{" "}
          <code class="text-rose-400">rects:</code>
        </div>
        <div class="mt-1 text-white/40">drenv (DragonRuby 7.13)</div>
      </div>
    </Editor>
  );
}

type Ref = { loc: string; code: string; current?: boolean };
const REFERENCES: Ref[] = [
  {
    loc: "lib/conjuration/animation.rb:233",
    code: "def play(name)",
    current: true,
  },
  { loc: "app/scenes/hero.rb:12", code: "@hero_anim.play(:walk)" },
  { loc: "app/scenes/hero.rb:27", code: "@hero_anim.play(:idle)" },
];

function NavigationMock() {
  return (
    <Editor file="mygame/app/scenes/hero.rb">
      <div>
        <span class="text-zinc-100">@hero_anim.</span>
        <span class="cursor-pointer text-sky-300 underline decoration-sky-300/60 underline-offset-4">
          play
        </span>
        <span class="text-zinc-100">(:walk)</span>
      </div>
      <div class="mt-2 w-96 max-w-full overflow-hidden rounded-lg border border-white/15 bg-zinc-900 shadow-xl">
        <div class="border-b border-white/10 px-3 py-1.5 text-[11px] tracking-wide text-white/45">
          References · 3
        </div>
        {REFERENCES.map((r) => (
          <div
            class={`flex items-baseline gap-3 px-3 py-1 text-[12px] ${
              r.current ? "bg-sky-500/15" : ""
            }`}
          >
            <span class="whitespace-nowrap text-white/40">{r.loc}</span>
            <span class="ml-auto whitespace-nowrap text-zinc-100">
              {r.code}
            </span>
          </div>
        ))}
      </div>
    </Editor>
  );
}

function ManifestMock() {
  return (
    <Editor file="mygame/drenv.toml">
      <div>
        <span class="text-zinc-100">[package]</span>
      </div>
      <div>
        <span class="text-sky-300">name</span>
        <span class="text-zinc-100">{" = "}</span>
        <span class="text-emerald-300">"my_game"</span>
      </div>
      <div>
        <Wavy>
          <span class="text-sky-300">entrypint</span>
        </Wavy>
        <span class="text-zinc-100">{" = "}</span>
        <span class="text-emerald-300">"app/game.rb"</span>
      </div>
      <div class="mt-2 w-96 max-w-full rounded-lg border border-amber-400/30 bg-zinc-900 p-3 text-[12px] leading-5 shadow-xl">
        <div class="text-white/80">
          <span class="text-amber-300">⚠</span> unknown key{" "}
          <code class="text-rose-400">entrypint</code> in [package] — known:
          {" "}
          <code class="text-rose-400">root</code>,{" "}
          <code class="text-rose-400">entrypoint</code>,{" "}
          <code class="text-rose-400">include</code>
        </div>
        <div class="mt-1 text-white/40">drenv</div>
      </div>
    </Editor>
  );
}

type Showcase = {
  title: string;
  desc: string;
  mock: () => ComponentChildren;
};

const SHOWCASES: Showcase[] = [
  {
    title: "Completions",
    desc:
      "The full args.* tree, Geometry and Easing, mruby core methods, and your project's own definitions — vendored libraries included. One-hop typing means enemies = [] makes enemies. complete like an Array, and @anim = Animation.new completes your class's methods, inherited ones too.",
    mock: CompletionMock,
  },
  {
    title: "Docs on hover",
    desc:
      "The same content docs.dragonruby.org serves, matched to the engine version your project actually uses. Your own comment blocks render too — YARD tags become rich markdown with clickable constant links.",
    mock: HoverMock,
  },
  {
    title: "Signature help",
    desc:
      "Positional and keyword parameters with the active argument highlighted as you type — including DragonRuby's paren-less call style. Signatures come from the engine's own source.",
    mock: SignatureMock,
  },
  {
    title: "Diagnostics",
    desc:
      "Unknown engine methods, wrong argument counts, unknown or missing keywords, duck-shape checks, and performance hints linked to the engine's shipped guide. Warnings only fire when the server fully owns the receiver — a squiggle means something is actually wrong.",
    mock: DiagnosticsMock,
  },
  {
    title: "Navigation",
    desc:
      "Go to definition and references across mygame/ and vendor/, resolved the way Ruby dispatches: own class, superclass chain, then same file. Locals stay method-scoped, and if a library you're developing is vendored into the same workspace, results point at the editable source — not the vendored copy.",
    mock: NavigationMock,
  },
  {
    title: "drenv.toml",
    desc:
      "Validation and key completion for the dependency manifest, from the same schema the CLI uses — typos and unknown sources get flagged before you ever run drenv bundle.",
    mock: ManifestMock,
  },
];

export default function LspDocs() {
  return (
    <>
      <Head>
        <title>Editor intelligence — drenv</title>
      </Head>
      <div class="min-h-screen bg-zinc-950 text-white">
        <Nav />

        <main class="mx-auto max-w-5xl px-6 py-16">
          <div class="mb-4 text-xs tracking-[2px] text-rose-500">
            EXPERIMENTAL
          </div>
          <h1 class="text-4xl font-bold tracking-tight">
            DragonRuby intelligence in your editor
          </h1>
          <p class="mt-4 max-w-2xl text-lg text-white/70">
            drenv ships a language server for DragonRuby projects. No gems, no
            Ruby toolchain, no stub repositories — everything is derived from
            the engine version your project actually uses, offline, including
            your vendored dependencies.
          </p>
          <p class="mt-3 text-sm text-white/55">
            Requires drenv <code class="text-rose-400">0.17.0</code>{" "}
            or newer — check with{" "}
            <code class="text-rose-400">drenv --version</code>, upgrade with
            {" "}
            <code class="text-rose-400">drenv self-update</code>. On older
            versions editors report the server crashing on startup.
          </p>

          <div class="mt-16 space-y-16">
            {SHOWCASES.map((s) => (
              <section class="grid items-center gap-8 md:grid-cols-[1fr_1.2fr]">
                <div>
                  <h2 class="text-2xl font-semibold tracking-tight">
                    {s.title}
                  </h2>
                  <p class="mt-3 text-sm leading-relaxed text-white/70">
                    {s.desc}
                  </p>
                </div>
                {s.mock()}
              </section>
            ))}
          </div>

          <section class="mt-16">
            <h2 class="mb-6 text-2xl font-semibold tracking-tight">
              Editor setup
            </h2>
            <p class="mb-6 text-sm text-white/60">
              Install{" "}
              <a href="https://drenv.org" class="underline hover:text-white/80">
                drenv
              </a>{" "}
              0.17.0 or newer first, so <code class="text-rose-400">drenv</code>
              {" "}
              is on your <code class="text-rose-400">PATH</code>.
            </p>
            <div class="space-y-6">
              <div class="rounded-xl border border-white/10 bg-zinc-900/50 p-5">
                <div class="font-semibold">VS Code</div>
                <p class="mt-2 text-sm text-white/70">
                  Install{" "}
                  <a
                    href="https://marketplace.visualstudio.com/items?itemName=nitemaeric.drenv-lsp"
                    class="underline hover:text-white/80"
                  >
                    drenv
                  </a>{" "}
                  from the Marketplace — search{" "}
                  <span class="text-white/90">drenv</span>{" "}
                  in the Extensions panel, or run{" "}
                  <code class="text-rose-400">
                    code --install-extension nitemaeric.drenv-lsp
                  </code>. Open a Ruby file in a DragonRuby project and it
                  activates.
                </p>
              </div>
              <div class="rounded-xl border border-white/10 bg-zinc-900/50 p-5">
                <div class="font-semibold">Emacs</div>
                <p class="mt-2 text-sm text-white/70">
                  With built-in <span class="text-white/90">eglot</span>{" "}
                  (Emacs 29+), register the server for Ruby:
                </p>
                <pre class="mt-3 overflow-x-auto rounded-lg border border-white/10 bg-black px-4 py-3 font-mono text-xs text-emerald-300"><code>{`(with-eval-after-load 'eglot
  (add-to-list 'eglot-server-programs
               '((ruby-mode ruby-ts-mode) . ("drenv" "lsp"))))`}</code></pre>
                <p class="mt-3 text-sm text-white/70">
                  Then <code class="text-rose-400">M-x eglot</code>{" "}
                  in a DragonRuby project. Full eglot and lsp-mode setup in{" "}
                  <a
                    href="https://github.com/Nitemaeric/drenv/blob/main/editors/emacs/README.md"
                    class="underline hover:text-white/80"
                  >
                    editors/emacs
                  </a>.
                </p>
              </div>
              <div class="rounded-xl border border-white/10 bg-zinc-900/50 p-5">
                <div class="font-semibold">Zed</div>
                <p class="mt-2 text-sm text-white/70">
                  Coming to the Zed extension registry (review pending). Until
                  then, clone the repo and run{" "}
                  <code class="text-rose-400">zed: install dev extension</code>
                  {" "}
                  on{" "}
                  <code class="text-rose-400">editors/zed/</code>. Safe to
                  enable globally — the server stays dormant outside DragonRuby
                  projects.
                </p>
              </div>
              <div class="rounded-xl border border-white/10 bg-zinc-900/50 p-5">
                <div class="font-semibold">Any LSP editor</div>
                <p class="mt-2 text-sm text-white/70">
                  Point your client at command{" "}
                  <code class="text-rose-400">drenv</code> with args{" "}
                  <code class="text-rose-400">["lsp"]</code>{" "}
                  for Ruby files. The conventional{" "}
                  <code class="text-rose-400">--stdio</code>{" "}
                  flag is accepted. A Neovim config lives in{" "}
                  <a
                    href="https://github.com/Nitemaeric/drenv/blob/main/editors/nvim/README.md"
                    class="underline hover:text-white/80"
                  >
                    editors/nvim
                  </a>.
                </p>
              </div>
            </div>
            <p class="mt-6 text-sm text-white/55">
              Every rule, by feature, on the{" "}
              <a
                href="/docs/lsp/reference"
                class="underline hover:text-white/80"
              >
                rule reference
              </a>{" "}
              page. Project detection and troubleshooting in the{" "}
              <a
                href="https://github.com/Nitemaeric/drenv/blob/main/docs/lsp.md"
                class="underline hover:text-white/80"
              >
                LSP docs
              </a>.
            </p>
          </section>
        </main>

        <Footer />
      </div>
    </>
  );
}
