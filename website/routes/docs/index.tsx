import { Head } from "$fresh/runtime.ts";
import Nav from "../../components/Nav.tsx";
import Footer from "../../components/Footer.tsx";
import Terminal from "../../components/Terminal.tsx";
import denoConfig from "../../../deno.json" with { type: "json" };

const QUICK_START: [string, string?][] = [
  ["drenv install", "     # download DragonRuby (asks which tier you own)"],
  ["drenv new my-game", " # scaffold a project on that version"],
  ["cd my-game"],
  ["drenv run", "         # launch it"],
];

type Command = { name: string; desc: string };
type Group = { title: string; blurb: string; commands: Command[] };

const GROUPS: Group[] = [
  {
    title: "Engine management",
    blurb: "Install and organize DragonRuby versions.",
    commands: [
      {
        name: "install",
        desc:
          "Download the latest DragonRuby GTK. Prompts for your tier the first time and remembers it — standard from itch.io, indie and pro from dragonruby.org. Pass --tier to choose or switch.",
      },
      {
        name: "register <path>",
        desc:
          "Register a local install manually from a .zip or a directory. Pass --tier to file it under indie/pro.",
      },
      {
        name: "uninstall <version>",
        desc:
          "Remove an installed version (tier-resolved). Confirms first; pass -y to skip.",
      },
      {
        name: "versions",
        desc:
          "List installed versions, each tier labelled, with the current project's version marked.",
      },
      {
        name: "changelog [version]",
        desc:
          "Print the changelog entry for a version (defaults to the latest installed).",
      },
    ],
  },
  {
    title: "Project management",
    blurb: "Create, switch, run, and ship your game.",
    commands: [
      {
        name: "new <name>",
        desc:
          "Scaffold a new project on your newest install (or --version <v>), with a sensible .gitignore.",
      },
      {
        name: "use [version]",
        desc:
          "Switch the current project to another installed version. Defaults to your newest install.",
      },
      {
        name: "version",
        desc: "Print the current project's DragonRuby version.",
      },
      {
        name: "run [args...]",
        desc:
          "Sync dependencies and launch the project. Watches path deps and re-vendors them as you edit. Extra args go to dragonruby.",
      },
      {
        name: "publish [args...]",
        desc:
          "Verify dependencies against the lockfile, then run dragonruby-publish — always shipping exactly what's locked.",
      },
    ],
  },
  {
    title: "Dependency management",
    blurb: "Vendor Ruby libraries into your game, Bundler-style.",
    commands: [
      {
        name: "add <source>",
        desc:
          "Add and vendor a dependency. Sources: github:owner/repo[@tag], git:<url>, url:<url>, path:<dir>.",
      },
      {
        name: "remove <name>",
        desc: "Remove a dependency and its vendored copy.",
      },
      {
        name: "list",
        desc: "List declared dependencies and the revision each is locked to.",
      },
      {
        name: "update [name]",
        desc:
          "Re-resolve dependencies to their latest and rewrite the lockfile. A name updates just that one.",
      },
      {
        name: "outdated",
        desc: "Show dependencies whose upstream has moved past the lockfile.",
      },
      {
        name: "bundle",
        desc:
          "Resolve and vendor everything from drenv.toml. Pass --frozen to verify against the lockfile (CI).",
      },
    ],
  },
  {
    title: "Managing drenv",
    blurb: "Keep the tool itself current.",
    commands: [
      {
        name: "self-update",
        desc: "Update drenv itself to the latest release.",
      },
    ],
  },
];

function Snippet({ children }: { children: string }) {
  return (
    <pre class="overflow-x-auto rounded-lg border border-white/10 bg-black px-4 py-3 font-mono text-sm text-rose-400"><code>{children}</code></pre>
  );
}

export default function Docs() {
  return (
    <>
      <Head>
        <title>Documentation — drenv</title>
      </Head>
      <div class="bg-zinc-950 text-white">
        <Nav />

        <main class="mx-auto max-w-3xl px-6 py-16">
          <h1 class="mb-3 text-4xl font-semibold tracking-tight">
            Documentation
          </h1>
          <p class="mb-14 text-lg leading-relaxed text-white/70">
            drenv manages DragonRuby installs and your game's dependencies. Run
            {" "}
            <code class="text-rose-400">drenv &lt;command&gt; --help</code>{" "}
            for flags on any command.
          </p>

          {/* Install */}
          <section class="mb-14">
            <div class="mb-4 flex items-baseline gap-3">
              <h2 class="text-2xl font-semibold tracking-tight">Install</h2>
              <a
                href="https://github.com/Nitemaeric/drenv/releases/latest"
                class="rounded-full bg-white/5 px-2.5 py-0.5 text-xs tabular-nums text-white/60 transition-colors hover:text-white/90"
              >
                Latest v{denoConfig.version}
              </a>
            </div>
            <p class="mb-3 text-white/70">
              The install script downloads the right binary for your platform,
              drops it in{" "}
              <code class="text-rose-400">~/.drenv/bin</code>, and prints the
              line to add to your{" "}
              <code class="text-rose-400">
                $PATH
              </code>.
            </p>
            <div class="mb-2 text-xs tracking-[1px] text-white/50">
              macOS / Linux
            </div>
            <Snippet>curl -fsSL drenv.org/install.sh | bash</Snippet>
            <div class="mb-2 mt-4 text-xs tracking-[1px] text-white/50">
              Windows (PowerShell)
            </div>
            <Snippet>irm https://drenv.org/install.ps1 | iex</Snippet>
            <p class="mt-4 text-sm text-white/55">
              Keep it current with{" "}
              <code class="text-rose-400">drenv self-update</code>. On macOS, if
              Gatekeeper warns about a manually downloaded binary, run{" "}
              <code class="text-rose-400">
                xattr -d com.apple.quarantine ./drenv
              </code>.
            </p>
          </section>

          {/* Quick start */}
          <section class="mb-14">
            <h2 class="mb-4 text-2xl font-semibold tracking-tight">
              Quick start
            </h2>
            <Terminal lines={QUICK_START} />
            <p class="mt-4 text-sm text-white/55">
              <code class="text-rose-400">drenv new</code>{" "}
              uses your newest install by default. Standard, indie, and pro
              installs live side by side —{" "}
              <code class="text-rose-400">
                drenv versions
              </code>{" "}
              lists them, and a bare version resolves to your highest tier (pin
              one with e.g. <code class="text-rose-400">7.11-pro</code>).
            </p>
          </section>

          {/* Dependencies */}
          <section class="mb-14">
            <h2 class="mb-4 text-2xl font-semibold tracking-tight">
              Dependencies
            </h2>
            <p class="mb-3 text-white/70">
              Declare libraries in{" "}
              <code class="text-rose-400">
                mygame/drenv.toml
              </code>. drenv resolves them into{" "}
              <code class="text-rose-400">mygame/vendor/</code>, pins them in
              {" "}
              <code class="text-rose-400">drenv.lock</code>, and generates a
              bundle file you require once:
            </p>
            <Snippet>drenv add github:Nitemaeric/conjuration</Snippet>
            <p class="my-3 text-white/70">
              Then add one line to the top of{" "}
              <code class="text-rose-400">mygame/app/main.rb</code>:
            </p>
            <pre class="overflow-x-auto rounded-lg border border-white/10 bg-black px-4 py-3 font-mono text-sm text-emerald-300"><code>require 'app/drenv_bundle.rb'</code></pre>
            <p class="mt-4 text-sm text-white/55">
              Commit <code class="text-rose-400">drenv.toml</code> and{" "}
              <code class="text-rose-400">drenv.lock</code>; the vendored copies
              are reproducible and stay out of git. Full guide, including
              publishing a library, in the{" "}
              <a
                href="https://github.com/Nitemaeric/drenv/blob/main/docs/dependencies.md"
                class="underline hover:text-white/80"
              >
                dependencies docs
              </a>.
            </p>
          </section>

          {/* Editor intelligence */}
          <section class="mb-14">
            <h2 class="mb-4 flex items-center gap-3 text-2xl font-semibold tracking-tight">
              Editor intelligence
              <span class="rounded-full bg-rose-500/15 px-2.5 py-0.5 text-[10px] font-medium tracking-[1px] text-rose-400">
                EXPERIMENTAL
              </span>
            </h2>
            <p class="mb-3 text-white/70">
              drenv ships a language server for DragonRuby projects —
              completions, docs, diagnostics, and navigation derived from your
              installed engine version. Zed and VS Code supported. Requires
              drenv <code class="text-rose-400">0.17.0</code> or newer.
            </p>
            <a href="/docs/lsp" class="text-sm underline hover:text-white/80">
              Set up your editor →
            </a>
          </section>

          {/* Command reference */}
          <section>
            <h2 class="mb-6 text-2xl font-semibold tracking-tight">
              Command reference
            </h2>
            <div class="space-y-10">
              {GROUPS.map((group) => (
                <div>
                  <div class="mb-1 text-xs tracking-[2px] text-rose-500">
                    {group.title.toUpperCase()}
                  </div>
                  <p class="mb-4 text-sm text-white/50">{group.blurb}</p>
                  <div class="divide-y divide-white/10 overflow-hidden rounded-xl border border-white/10 bg-zinc-900/50">
                    {group.commands.map((cmd) => (
                      <div class="p-5">
                        <code class="font-mono text-[15px] text-rose-400">
                          drenv {cmd.name}
                        </code>
                        <p class="mt-2 text-sm leading-snug text-white/70">
                          {cmd.desc}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </main>

        <Footer />
      </div>
    </>
  );
}
