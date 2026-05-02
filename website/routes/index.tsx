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
      <section class="relative h-[100dvh] flex flex-col">
        {/* Top Navigation */}
        <nav class="flex items-center justify-between px-6 py-5 border-b border-white/10">
          <div class="flex items-center gap-2">
            <div class="w-7 h-7 rounded bg-emerald-500 flex items-center justify-center">
              <span class="text-zinc-950 font-bold text-sm">d</span>
            </div>
            <span class="font-semibold tracking-tight text-xl">drenv</span>
          </div>
          <div class="flex items-center gap-6 text-sm">
            <a href="https://github.com/Nitemaeric/drenv" target="_blank" class="hover:text-white/70 transition-colors">GitHub</a>
            <a href="https://github.com/Nitemaeric/drenv/releases" target="_blank" class="hover:text-white/70 transition-colors">Releases</a>
            <a href="#about" class="hover:text-white/70 transition-colors">Docs</a>
          </div>
        </nav>

        {/* Centered Hero Content */}
        <div class="flex-1 flex items-center justify-center px-6">
          <div class="max-w-2xl text-center">
            <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 text-xs tracking-[3px] text-emerald-400 mb-6">
              DRAGONRUBY ENVIRONMENT MANAGER
            </div>

            <h1 class="text-6xl sm:text-7xl font-semibold tracking-tighter mb-4">
              The right way to<br />manage DragonRuby.
            </h1>
            <p class="text-xl text-white/70 max-w-md mx-auto">
              Install, switch, and manage DragonRuby versions with ease.
              Inspired by rbenv. Built for developers.
            </p>

            {/* Prominent Install Command */}
            <div class="mt-10 mx-auto max-w-xl">
              <div class="group relative rounded-xl bg-zinc-900 border border-white/10 p-1 shadow-2xl">
                <div class="flex items-center justify-between px-5 py-4 font-mono text-sm bg-black/60 rounded-[10px]">
                  <code class="select-all text-emerald-400 pr-4">
                    {INSTALL_COMMAND}
                  </code>
                  <button
                    onClick={copyToClipboard}
                    class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-white/5 hover:bg-white/10 active:bg-white/15 transition-all border border-white/10"
                  >
                    {copied.value ? (
                      <>
                        <span>Copied!</span>
                      </>
                    ) : (
                      <>
                        <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16v-4m4 4v4m4-8v8m4-4v-4m-8-4V4m0 0H8m4 0h4" />
                        </svg>
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
              <p class="mt-3 text-xs text-white/50">
                Also works from GitHub:{" "}
                <code class="font-mono text-[10px] bg-white/5 px-1 py-px rounded">curl -fsSL https://raw.githubusercontent.com/Nitemaeric/drenv/main/website/install.sh | bash</code>
              </p>
            </div>
          </div>
        </div>

        {/* Scroll Indicator Arrow - Bottom Center */}
        <a
          href="#about"
          class="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center text-white/40 hover:text-white/70 transition-colors group"
          aria-label="Scroll to learn more"
        >
          <span class="text-[10px] tracking-[2px] mb-1.5 font-medium">SCROLL TO EXPLORE</span>
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
      <section id="about" class="max-w-3xl mx-auto px-6 pt-20 pb-24 text-center border-t border-white/10">
        <div class="text-emerald-500 text-xs tracking-[3px] mb-3">SIMPLE. RELIABLE. FAMILIAR.</div>
        <h2 class="text-4xl font-semibold tracking-tight mb-6">
          drenv is the <span class="text-white/90">rbenv for DragonRuby</span>.
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

      <footer class="border-t border-white/10 py-8 text-center text-xs text-white/40">
        <p>Built with ❤️ for the DragonRuby community • <a href="https://github.com/Nitemaeric/drenv" class="underline hover:text-white/60">Source on GitHub</a></p>
      </footer>
    </div>
  );
}
