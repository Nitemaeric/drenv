import { Head } from "$fresh/runtime.ts";
import Nav from "../components/Nav.tsx";
import Footer from "../components/Footer.tsx";

export default function Error404() {
  return (
    <>
      <Head>
        <title>404 — Page not found · drenv</title>
      </Head>
      <div class="flex min-h-[100dvh] flex-col bg-zinc-950 text-white">
        <Nav />
        <main class="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <div class="mb-4 text-7xl font-semibold tracking-tight text-white/90">
            404
          </div>
          <p class="mb-8 text-white/60">That page doesn't exist.</p>
          <a
            href="/"
            class="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-medium text-zinc-950 transition-colors hover:bg-white/90"
          >
            Back home <span aria-hidden="true">→</span>
          </a>
        </main>
        <Footer />
      </div>
    </>
  );
}
