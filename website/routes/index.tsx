import { useSignal } from "@preact/signals";

const INSTALL_COMMAND = 'curl -fsSL drenv.org/install.sh | bash';

export default function Home() {
  const copied = useSignal(false);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND);
      copied.value = true;
      setTimeout(() => {
        copied.value = false;
      }, 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <div class="bg-zinc-950 text-white">
      {/* Hero Section - 100dvh */}
      <section class="relative h-[100dvh] flex flex-col bg-zinc-950 overflow-hidden">
        {/* Subtle animated dot grid texture (fades near bottom) */}
        <div class="hero-texture absolute inset-0 z-0" aria-hidden="true" />

        {/* Centered Hero Content */}
        <div class="relative z-10 flex-1 flex items-center justify-center px-6">
          <div class="max-w-2xl text-center">
            {/* Official DragonRuby Logo (to show what drenv is for) */}
            <div class="flex justify-center mb-5">
              <img 
                src="https://dragonruby.org/assets/logo-e7ffdf25e7e410056429e9378cdc22a931780525e1b9411478d17c86509a2a22.png" 
                alt="DragonRuby" 
                class="h-9 w-auto opacity-90" 
              />
            </div>

            <h1 class="text-[92px] sm:text-[110px] font-semibold tracking-[-5.5px] leading-[0.82] mb-3 text-white">
              drenv
            </h1>

            <p class="text-2xl tracking-tight text-white/75 mb-10">
              DragonRuby Environment Manager
            </p>

            {/* Prominent Install Command */}
            <div class="mt-6 mx-auto max-w-xl">
              <div class="group relative rounded-xl bg-zinc-900 border border-white/10 p-1 shadow-2xl">
                <div class="flex items-center justify-between px-5 py-4 font-mono text-sm bg-black/60 rounded-[10px]">
                  <code class="select-all text-rose-400 pr-4">
                    {INSTALL_COMMAND}
                  </code>
                  <button
                    onClick={copyToClipboard}
                    class="relative flex h-8 w-8 items-center justify-center rounded-md text-white/60 hover:text-white hover:bg-white/10 active:bg-white/15 transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 group/copy"
                    aria-label="Copy Command"
                  >
                    {copied.value ? (
                      <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    )}

                    {/* Tooltip */}
                    <span class="absolute -top-9 left-1/2 -translate-x-1/2 px-2.5 py-1 text-xs font-medium bg-zinc-800 text-white rounded-md border border-white/10 opacity-0 group-hover/copy:opacity-100 group-focus/copy:opacity-100 pointer-events-none transition-opacity whitespace-nowrap shadow-lg">
                      {copied.value ? "Copied!" : "Copy Command"}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Scroll Indicator Arrow - Bottom Center (unaffected by texture fade) */}
        <a
          href="#about"
          class="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center text-white/40 hover:text-white/70 transition-colors group z-10"
          aria-label="Scroll to learn more"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="w-5 h-5 group-hover:translate-y-0.5 transition-transform"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.25" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </a>
      </section>

      {/* About / What is drenv Section */}
      <section id="about" class="max-w-3xl mx-auto px-6 pt-20 pb-24 text-center">
        <div class="text-rose-500 text-xs tracking-[3px] mb-3">SIMPLE. RELIABLE. FAMILIAR.</div>
        <h2 class="text-4xl font-semibold tracking-tight mb-6">
          drenv is the <span class="text-white/90">DragonRuby Environment Manager</span>.
        </h2>
        <p class="text-lg text-white/70 leading-relaxed max-w-2xl mx-auto">
          Multiple DragonRuby versions, global vs per-project, itch.io downloads, and painful PATH management —
          drenv solves all of it with a tiny, fast CLI that just works.
        </p>

        <div class="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-4 text-left">
          {[
            { title: "One-command installs", desc: "curl | bash installs the latest release and sets everything up." },
            { title: "Switch versions instantly", desc: "drenv global 3.4.0 and every new project uses the right runtime." },
            { title: "Works everywhere", desc: "macOS, Linux, and Windows. Full native support for PowerShell." },
          ].map((f, i) => (
            <div key={i} class="rounded-xl border border-white/10 bg-zinc-900/50 p-6">
              <div class="font-semibold mb-2">{f.title}</div>
              <div class="text-sm text-white/60 leading-snug">{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Key Commands Documentation */}
      <section class="max-w-3xl mx-auto px-6 pt-16 pb-20 border-t border-white/10">
        <div class="text-rose-500 text-xs tracking-[3px] mb-3 text-center">COMMAND REFERENCE</div>
        <h2 class="text-4xl font-semibold tracking-tight mb-10 text-center">
          Key Commands
        </h2>

        {/* Featured: drenv install */}
        <div class="mb-10 rounded-2xl border border-white/10 bg-zinc-900/70 p-8">
          <div class="flex flex-wrap items-center gap-x-4 gap-y-1 mb-4">
            <code class="font-mono text-2xl text-rose-400">drenv install</code>
            <span class="inline-block text-[10px] px-2.5 py-px rounded-full bg-rose-500/15 text-rose-400 tracking-[1.5px] font-medium">PRIMARY COMMAND</span>
          </div>

          <p class="text-lg text-white/80 leading-relaxed mb-6">
            Downloads and installs the latest DragonRuby GTK directly from your itch.io account.
          </p>

          <div class="text-white/75 space-y-3 mb-6 text-[15px]">
            <div class="flex gap-3">
              <span class="text-rose-400/80 mt-1">•</span>
              <span>First run securely prompts for your itch.io username/email and password. Credentials are stored in a local encrypted database (never sent anywhere else).</span>
            </div>
            <div class="flex gap-3">
              <span class="text-rose-400/80 mt-1">•</span>
              <span>Supports two-factor authentication (TOTP). If enabled, you'll be prompted for your 2FA code.</span>
            </div>
            <div class="flex gap-3">
              <span class="text-rose-400/80 mt-1">•</span>
              <span>Automatically selects the correct build for your platform (Apple Silicon / Intel macOS, Linux x64/arm64, Windows).</span>
            </div>
            <div class="flex gap-3">
              <span class="text-rose-400/80 mt-1">•</span>
              <span>Registers the downloaded version locally and sets it as your global default (if no global version is configured yet).</span>
            </div>
          </div>

          <div class="mt-6">
            <div class="text-xs uppercase tracking-[2px] text-white/50 mb-2">Usage</div>
            <div class="font-mono text-sm bg-black border border-white/10 rounded-xl px-6 py-4 text-rose-400">
              drenv install
            </div>
            <p class="mt-3 text-xs text-white/50">Only the standard tier is supported at this time.</p>
          </div>
        </div>

        {/* Other core commands */}
        <div class="grid gap-4 sm:grid-cols-2">
          {[
            {
              cmd: "drenv register <path>",
              desc: "Manually register an existing DragonRuby installation from a .zip file or directory containing the dragonruby executable.",
            },
            {
              cmd: "drenv global [version]",
              desc: "Set the global DragonRuby version used when creating new projects. Run without arguments to see the current global version.",
            },
            {
              cmd: "drenv versions",
              desc: "List all installed DragonRuby versions. The active global version is marked with an asterisk (*).",
            },
            {
              cmd: "drenv new <name>",
              desc: "Create a new DragonRuby project by copying the global version into a fresh directory.",
            },
            {
              cmd: "drenv upgrade",
              desc: "Download and install the latest release of drenv itself.",
            },
          ].map((cmd, i) => (
            <div key={i} class="rounded-xl border border-white/10 bg-zinc-900/50 p-6">
              <code class="font-mono text-rose-400 text-[15px]">{cmd.cmd}</code>
              <p class="mt-3 text-sm text-white/70 leading-snug">{cmd.desc}</p>
            </div>
          ))}
        </div>

        <p class="mt-10 text-center text-sm text-white/50">
          Full source and additional details available on{" "}
          <a href="https://github.com/Nitemaeric/drenv" class="underline hover:text-white/70 transition-colors">GitHub</a>.
        </p>
      </section>

      <footer class="border-t border-white/10 py-8 text-center text-xs text-white/40">
        <p>Built with ❤️ for the DragonRuby community • <a href="https://github.com/Nitemaeric/drenv" class="underline hover:text-white/60">Source on GitHub</a></p>
      </footer>
    </div>
  );
}
