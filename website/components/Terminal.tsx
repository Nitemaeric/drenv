/**
 * A multi-line command block. Newlines are emitted explicitly because JSX
 * strips literal newlines between elements at compile time — a `<pre>` alone
 * would collapse every line into one.
 */
export default function Terminal(
  { lines }: { lines: [command: string, comment?: string][] },
) {
  return (
    <pre class="overflow-x-auto rounded-xl border border-white/10 bg-black px-5 py-4 font-mono text-sm leading-relaxed"><code>{lines.map(([command, comment], i) => (
      <span key={i}>
        <span class="text-white/90">{command}</span>
        {comment ? <span class="text-white/40">{comment}</span> : null}
        {i < lines.length - 1 ? "\n" : null}
      </span>
    ))}</code></pre>
  );
}
