import { Head } from "$fresh/runtime.ts";
import Nav from "../../components/Nav.tsx";
import Footer from "../../components/Footer.tsx";

type Feature = { title: string; desc: string };

const FEATURES: Feature[] = [
  {
    title: "Completions",
    desc:
      "The full args.* tree, Geometry and Easing, mruby core methods on literal receivers, your project's and vendored libraries' definitions — plus one-hop typed variables: enemies = [] makes enemies. complete Array.",
  },
  {
    title: "Docs on hover",
    desc:
      "The same content docs.dragonruby.org serves, matched to your installed engine version. Your own comment blocks render too — YARD tags become rich markdown with clickable constant links.",
  },
  {
    title: "Signature help",
    desc:
      "Positional and keyword parameters with the active argument highlighted, including DragonRuby's paren-less call style.",
  },
  {
    title: "Navigation",
    desc:
      "Go to definition and references across mygame/ and vendor/, resolved the way Ruby dispatches: own class, superclass chain, then same file. Locals stay method-scoped.",
  },
  {
    title: "Diagnostics",
    desc:
      "Syntax errors, unknown engine methods, wrong argument counts, unknown or missing keywords, duck-shape checks derived from the engine's own source — and performance hints linked to the shipped performance guide.",
  },
  {
    title: "drenv.toml",
    desc:
      "Validation and key completion for the dependency manifest, from the same schema the CLI uses.",
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

          <section class="mt-12 grid gap-4 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <div class="rounded-xl border border-white/10 bg-zinc-900/50 p-5">
                <div class="font-semibold">{f.title}</div>
                <p class="mt-2 text-sm leading-snug text-white/70">{f.desc}</p>
              </div>
            ))}
          </section>

          <section class="mt-16">
            <h2 class="mb-2 text-2xl font-semibold tracking-tight">
              Honest squiggles
            </h2>
            <p class="max-w-2xl text-white/70">
              Completions are generous; warnings are certain. A diagnostic only
              fires when the server fully owns the receiver and the arguments
              are statically known — so a squiggle in a DragonRuby project means
              something is actually wrong.
            </p>
          </section>

          <section class="mt-16">
            <h2 class="mb-6 text-2xl font-semibold tracking-tight">
              Editor setup
            </h2>
            <div class="space-y-6">
              <div class="rounded-xl border border-white/10 bg-zinc-900/50 p-5">
                <div class="font-semibold">Zed</div>
                <p class="mt-2 text-sm text-white/70">
                  Install the drenv extension. Until it reaches the extension
                  registry: clone the repo and run{" "}
                  <code class="text-rose-400">zed: install dev extension</code>
                  {" "}
                  on{" "}
                  <code class="text-rose-400">editors/zed/</code>. Safe to
                  enable globally — the server stays dormant outside DragonRuby
                  projects.
                </p>
              </div>
              <div class="rounded-xl border border-white/10 bg-zinc-900/50 p-5">
                <div class="font-semibold">VS Code</div>
                <p class="mt-2 text-sm text-white/70">
                  Install the extension. Until it reaches the marketplace: build
                  the <code class="text-rose-400">.vsix</code> from{" "}
                  <code class="text-rose-400">editors/vscode/</code> and{" "}
                  <code class="text-rose-400">
                    code --install-extension drenv-lsp-*.vsix
                  </code>.
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
              Full reference, project detection rules, and troubleshooting in
              the{" "}
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
