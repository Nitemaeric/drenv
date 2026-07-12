import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";

/**
 * The install command with per-OS detection and copy-to-clipboard. This lives
 * in an island (not a route) so its effects and click handler actually run in
 * the browser.
 */
export default function InstallCommand({ version }: { version?: string }) {
  const copied = useSignal(false);
  const command = useSignal("curl -fsSL drenv.org/install.sh | bash");
  const osLabel = useSignal("");

  useEffect(() => {
    const ua = navigator.userAgent || "";
    const platform = navigator.platform || "";
    const isWindows = /windows/i.test(ua) || /win/i.test(platform);

    if (isWindows) {
      command.value = "irm https://drenv.org/install.ps1 | iex";
      osLabel.value = "Windows (PowerShell)";
    } else {
      osLabel.value = "macOS / Linux";
    }
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command.value);
      copied.value = true;
      setTimeout(() => (copied.value = false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <div class="mx-auto mt-6 max-w-xl">
      <div class="mb-1.5 flex items-center justify-between pl-1 text-xs tracking-[1px] text-white/50">
        <span>{osLabel.value}</span>
        {version && (
          <a
            href="https://github.com/Nitemaeric/drenv/releases/latest"
            class="tabular-nums transition-colors hover:text-white/80"
          >
            Latest v{version}
          </a>
        )}
      </div>
      <div class="group relative rounded-xl border border-white/10 bg-zinc-900 p-1 shadow-2xl">
        <div class="flex items-center justify-between rounded-[10px] bg-black/60 px-5 py-4 font-mono text-sm">
          <code class="select-all pr-4 text-rose-400">{command.value}</code>
          <button
            type="button"
            onClick={copy}
            class="group/copy relative flex h-8 w-8 items-center justify-center rounded-md text-white/60 transition-all hover:bg-white/10 hover:text-white active:bg-white/15 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
            aria-label="Copy command"
          >
            {copied.value
              ? (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-4 w-4 text-emerald-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2.5"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              )
              : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
              )}
            <span class="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md border border-white/10 bg-zinc-800 px-2.5 py-1 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity group-hover/copy:opacity-100 group-focus/copy:opacity-100">
              {copied.value ? "Copied!" : "Copy command"}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
