import { Head } from "$fresh/runtime.ts";
import { defineRoute } from "$fresh/server.ts";
import Nav from "../../../components/Nav.tsx";
import Footer from "../../../components/Footer.tsx";
import { latestVersion } from "../../../utils/version.ts";

// `since` defaults to 0.17.0 (when the language server first shipped); set it
// only on rules added in a later release.
type Rule = { name: string; detail: string; tag?: string; since?: string };
type Group = { id: string; title: string; blurb: string; rules: Rule[] };

const GROUPS: Group[] = [
  {
    id: "completions",
    title: "Completions",
    blurb:
      "Sources are tried in order; the first that matches the receiver wins. Completions are generous — they may come from partial knowledge.",
    rules: [
      {
        name: "Engine module methods",
        detail:
          "A constant receiver parsed from the installed engine's Ruby source — Geometry. and Easing. — completes with the method's signature and doc.",
      },
      {
        name: "args.* chain tree",
        detail:
          "The full tree derived from the engine's docs and runtime source: args, args.inputs (+ keyboard, mouse, controller_one–four), args.outputs, args.audio, args.events, args.grid, args.layout, args.geometry, args.gtk. args.state / args.cvars / args.pixel_arrays appear as args. members but hold runtime/user-defined data, so they expose no static sub-members.",
      },
      {
        name: "Core methods on literal receivers",
        detail:
          '[1, 2]. → Array, "s". → String, {}. → Hash, 5. → Numeric, :s. → Symbol. Names come from a curated mruby baseline plus DragonRuby\'s own core-class extensions parsed from the engine (e.g. Array#map_2d).',
      },
      {
        name: "Class-level variants",
        detail:
          "Constructor-style class methods documented in the engine — Array.filter_map, Array.new — complete on the bare class.",
      },
      {
        name: "One-hop typed variables",
        detail:
          "A local typed by its assignment completes its class: enemies = [] → Array; @anim = Animation.new → the workspace class's methods (inherited through the superclass chain); @ivar assignments that all agree on one type; and a method receiver typed by its unique @return (camera.ui. → the ui method's return class). Inference stops after one hop.",
      },
      {
        name: "Hash-literal keys",
        since: "0.17.3",
        detail:
          "h = { hp: 100 } → h. completes hp — DragonRuby patches Hash so h.hp reads h[:hp]. Keys list before the Hash methods; string keys are skipped (not dot-accessible).",
      },
      {
        name: "Workspace definitions",
        detail:
          "Methods, classes, modules, attr_reader/writer/accessor, and def self.x singletons across mygame/ and vendor/. A def's YARD doc rides the completion when the name is unambiguous.",
      },
    ],
  },
  {
    id: "hover",
    title: "Docs on hover",
    blurb:
      "Resolution is ordered from most specific to least; the first match returns.",
    rules: [
      {
        name: "Engine API methods",
        detail:
          "Geometry.distance and the args.* members show the exact markdown docs.dragonruby.org serves, matched to your installed engine version.",
      },
      {
        name: "Core / class methods",
        detail:
          "A method on a literal or typed core receiver ([1,2].each) shows the engine's Array#each doc.",
      },
      {
        name: "Instance & class variables",
        detail:
          "@ivar / @@cvar show the class they belong to, and borrow the doc of a same-named attr_* in that class.",
      },
      {
        name: "Parameters & locals",
        detail:
          'A parameter or local resolves to its method ("parameter of Class#method"); a parameter also shows its @param type and description from the method\'s doc block.',
      },
      {
        name: "Bare constants (lexical lookup)",
        since: "0.17.4",
        detail:
          "A bare constant resolves the way Ruby does — enclosing namespaces first, then top-level. Layout inside module Main sees Main::Layout / ::Layout, never an unrelated Conjuration::UI::Layout that merely shares the name.",
      },
      {
        name: "Def-site & workspace defs",
        detail:
          "Hovering a definition pins its qualified name and doc. A reopened name collapses to one entry; a genuinely ambiguous call lists candidates instead of guessing.",
      },
      {
        name: "YARD rendering",
        detail:
          "Comment blocks render as markdown: @param / @return / @yield / @yieldparam / @yieldreturn / @raise as typed sections, @note & @deprecated as callouts, @see and type references as links resolved namespace-relatively, @example as a fenced ruby block, unknown tags italicised, and RDoc +code+ as inline code.",
      },
    ],
  },
  {
    id: "signature",
    title: "Signature help",
    blurb: "For engine methods with a parsed signature.",
    rules: [
      {
        name: "Active-parameter tracking",
        detail:
          "As you type arguments, the current parameter is highlighted — positional or keyword. Works on DragonRuby's paren-less call style, tracked from the syntax tree rather than counting commas.",
      },
      {
        name: "Signature detail",
        detail:
          "Completions and hovers show the full signature, e.g. distance(point_one, point_two).",
      },
    ],
  },
  {
    id: "diagnostics",
    title: "Diagnostics",
    blurb:
      "Warnings fire only when the server owns the full surface — the receiver is an engine module and the arguments are statically known (a literal, or a one-hop literal variable). Performance hints are Information, never warnings. A squiggle means something is actually wrong.",
    rules: [
      {
        name: "Syntax errors",
        tag: "Error",
        detail: "tree-sitter error and missing nodes.",
      },
      {
        name: "Method validity",
        tag: "Warning",
        detail:
          "An unknown method on a fully-owned receiver (Geometry, Easing) — names the engine version. Array etc. have core methods beyond the documented set, so they get completions but never validity warnings.",
      },
      {
        name: "Positional arity",
        tag: "Warning",
        detail:
          "Argument count outside the method's required..max range, quoting the signature. A trailing **opts splat and a collapsed trailing options-hash are handled.",
      },
      {
        name: "Unknown keyword",
        tag: "Warning",
        detail:
          "A keyword the method doesn't accept — lists the accepted keywords. Label (anchor_x:) and hash-rocket (:anchor_x =>) forms both normalise.",
      },
      {
        name: "Missing required keyword",
        tag: "Warning",
        detail:
          "A keyword parameter with no default that wasn't passed (suppressed when a **opts splat forwards keywords).",
      },
      {
        name: "Duck-shape check",
        tag: "Warning",
        detail:
          "A hash-literal argument missing the geometric attributes the engine's own method body reads off that parameter (e.g. Geometry.distance reads .x/.y on both points). Extends to one-hop literal-hash variables; never to inferred or dispatched types.",
      },
      {
        name: "Array manipulation during iteration",
        tag: "Information · array-manipulation",
        detail:
          "Mutating a collection (delete/push/<</…) inside its own .each block. Collect changes and apply them after the loop.",
      },
      {
        name: "Array primitive to a render layer",
        tag: "Information · array-primitives",
        detail:
          "outputs.<layer> << [ … ] renders an Array primitive; a Hash is faster.",
      },
      {
        name: "Per-iteration render append",
        tag: "Information · bulk-concatenation",
        detail:
          "Appending to outputs.<layer> once per loop iteration — build an Array and concatenate once.",
      },
      {
        name: "Direct recursion",
        tag: "Information · recursion",
        detail:
          "A method that calls itself — deep recursion risks exhausting mruby's stack at 60fps.",
      },
      {
        name: "Discarded .map",
        tag: "Information · unused-map",
        detail:
          "A block-form .map standing as a non-final statement whose result is thrown away — .each expresses the intent.",
      },
      {
        name: "Tick-reachability gating",
        tag: "severity modifier",
        detail:
          "Performance hints are softened from Information to Hint for methods provably invoked but never reachable from a tick (not hot per-frame). Methods on the tick call graph, or with no known callers, keep Information. Each links the engine's Troubleshoot Performance guide.",
      },
    ],
  },
  {
    id: "navigation",
    title: "Navigation",
    blurb: "Go-to-definition and find-references across mygame/ and vendor/.",
    rules: [
      {
        name: "Parameters & locals",
        detail:
          "Jump to the definition line; references stay scoped to the enclosing method.",
      },
      {
        name: "Bare constants",
        since: "0.17.4",
        detail:
          "Resolve lexically (enclosing namespaces, then top-level) — a constant not visible from the cursor jumps nowhere rather than to an unrelated namespace.",
      },
      {
        name: "Methods",
        detail:
          "A one-hop inferred receiver type narrows candidates to that class chain first, then the enclosing class, superclass chain, and same file — Ruby's dispatch order. def self.x singletons are navigable.",
      },
      {
        name: "Vendored-twin dedup",
        detail:
          "When a library you're developing is vendored into the same workspace, navigation points at the editable source, not the vendored build artifact.",
      },
    ],
  },
  {
    id: "manifest",
    title: "drenv.toml",
    blurb:
      "Language service for the dependency manifest, from the CLI's schema.",
    rules: [
      {
        name: "Validation",
        detail:
          "Unknown keys, wrong value types, and malformed TOML surface as diagnostics (with best-effort positions), reusing the same schema drenv add / bundle enforce.",
      },
      {
        name: "Completion",
        detail:
          "Section names ([package], [dependencies]) and keys (root, entrypoint, include, and dependency source specs) complete in context.",
      },
    ],
  },
];

function GroupSection({ group }: { group: Group }) {
  return (
    <section id={group.id} class="scroll-mt-24">
      <h2 class="text-2xl font-semibold tracking-tight">{group.title}</h2>
      <p class="mt-2 max-w-2xl text-sm leading-relaxed text-white/60">
        {group.blurb}
      </p>
      <div class="mt-5 divide-y divide-white/10 overflow-hidden rounded-xl border border-white/10 bg-zinc-900/50">
        {group.rules.map((rule) => (
          <div class="p-5">
            <div class="flex flex-wrap items-baseline gap-2">
              <span class="font-medium text-white/90">{rule.name}</span>
              {rule.tag && (
                <span class="rounded bg-white/5 px-2 py-0.5 font-mono text-[11px] text-rose-400">
                  {rule.tag}
                </span>
              )}
              <span
                class="ml-auto shrink-0 font-mono text-[11px] text-white/35"
                title="Available since this release"
              >
                {rule.since ?? "0.17.0"}+
              </span>
            </div>
            <p class="mt-1.5 text-sm leading-snug text-white/70">
              {rule.detail}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

export default defineRoute(async () => {
  const version = await latestVersion();
  return (
    <>
      <Head>
        <title>LSP rule reference — drenv</title>
      </Head>
      <div class="min-h-screen bg-zinc-950 text-white">
        <Nav />

        <main class="mx-auto max-w-5xl px-6 py-16">
          <a
            href="/docs/lsp"
            class="text-sm text-white/50 transition-colors hover:text-white/80"
          >
            ← Editor intelligence
          </a>
          <div class="mt-4 flex items-baseline gap-3">
            <h1 class="text-4xl font-bold tracking-tight">Rule reference</h1>
            <span class="rounded-full bg-white/5 px-2.5 py-0.5 text-xs tabular-nums text-white/60">
              v{version}
            </span>
          </div>
          <p class="mt-4 max-w-2xl text-lg text-white/70">
            Every rule the drenv language server applies, by feature. All of it
            is derived from the DragonRuby version your project runs — new
            engine, new intelligence, automatically.
          </p>
          <p class="mt-3 max-w-2xl text-sm text-white/50">
            The <span class="font-mono text-white/70">x.y.z+</span>{" "}
            tag on each rule is the drenv release it arrived in.
          </p>

          <nav class="mt-8 flex flex-wrap gap-2">
            {GROUPS.map((g) => (
              <a
                href={`#${g.id}`}
                class="rounded-full border border-white/10 px-3 py-1 text-sm text-white/70 transition-colors hover:border-white/25 hover:text-white"
              >
                {g.title}
              </a>
            ))}
          </nav>

          <div class="mt-14 space-y-14">
            {GROUPS.map((group) => <GroupSection group={group} />)}
          </div>

          <section class="mt-16 rounded-xl border border-white/10 bg-zinc-900/50 p-6">
            <h2 class="text-lg font-semibold tracking-tight">
              Principles behind the rules
            </h2>
            <ul class="mt-3 space-y-2 text-sm text-white/70">
              <li>
                <span class="text-white/90">Engine-derived.</span>{" "}
                Methods, docs, signatures, shapes, and guide links come from the
                installed engine — never a curated list, with one documented
                exception (the plain-mruby core baseline, since the engine ships
                only patches against it).
              </li>
              <li>
                <span class="text-white/90">
                  Complete generously, warn conservatively.
                </span>{" "}
                Completions may come from partial knowledge; a diagnostic
                requires owning the full surface and statically-known arguments.
              </li>
              <li>
                <span class="text-white/90">Inference stops at one hop.</span>
                {" "}
                A receiver is typed from a single assignment or a single
                @return; that result is never re-fed to type a further hop.
              </li>
              <li>
                <span class="text-white/90">Dormant when irrelevant.</span>{" "}
                Outside a DragonRuby project the server advertises no
                capabilities, so it's safe to enable for Ruby globally.
              </li>
            </ul>
          </section>
        </main>

        <Footer />
      </div>
    </>
  );
});
