export default function Nav() {
  return (
    <header class="sticky top-0 z-50 border-b border-white/10 bg-zinc-950/80 backdrop-blur">
      <div class="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <a href="/" class="flex items-center gap-2">
          <img src="/icon.png" alt="" class="h-6 w-6 opacity-90" />
          <span class="text-lg font-semibold tracking-tight text-white">
            drenv
          </span>
          <span class="ml-1 rounded-full bg-rose-500/15 px-2 py-px text-[10px] font-medium tracking-[1px] text-rose-400">
            BETA
          </span>
        </a>
        <nav class="flex items-center gap-6 text-sm text-white/70">
          <a href="/docs" class="transition-colors hover:text-white">Docs</a>
          <a
            href="https://github.com/Nitemaeric/drenv"
            class="transition-colors hover:text-white"
          >
            GitHub
          </a>
        </nav>
      </div>
    </header>
  );
}
