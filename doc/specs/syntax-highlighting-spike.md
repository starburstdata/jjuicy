# Syntax highlighting spike (D-10)

Compared Shiki (JS regex engine, fine-grained language imports) against `@lezer/*` parsers with `@lezer/highlight`, for 14–15 common languages (js/ts, rust, python, css, scss, html, json, markdown, go, java, c/c++, php, xml, yaml).

| | minified | gzip |
|---|---|---|
| Lezer, all 14 grammars | 634 kB | 221 kB |
| Lezer, core only (`@lezer/highlight` + `@lezer/lr`) | — | 17 kB |
| Lezer, core + rust | 137 kB | 47 kB |
| Shiki core + JS engine + 15 grammars | 1.9 MB | 245 kB |

- **Size:** Lezer grammars are small and load as one dynamic-import chunk per language, so a session only pays for the languages it opens. Shiki's TextMate grammars are 3× larger minified, and it needs the regex engine as well.
- **Incremental tokenisation:** Lezer parses a document into a tree in a single pass. In Node it highlighted `src/worker/mutations/change.rs` (2.4k lines, 20k spans) in 86 ms. Shiki tokenises line by line with grammar state carried between lines, which is cheap to resume but slower overall.
- **Class names:** `tagHighlighter` maps tags straight to class names, and those map onto the theme's `[syntax]` tokens (`--ju-syntax-*`). Shiki emits inline colours from a bundled theme, so it would need a custom CSS-variables theme.
- **Partial documents:** both cope with fragments. Lezer's error recovery keeps a hunk that starts mid-construct readable.

**Decision:** Lezer, as the plan recommended.

## Implementation notes

- `app/diff/highlight.ts`
  - Maps extensions to grammars and loads each grammar lazily.
  - `DiffHighlighter` highlights each contiguous stretch of rows between gaps as one document, so multi-line strings and comments colour correctly. It highlights only the stretches that intersect the virtualised window.
  - The old side (removed + context) and the new side (added + context) are highlighted as separate documents, so an edit can't leak a construct across sides.
- Word-diff tokens (D-9) stay the outer span layer, with syntax classes nested inside (`syntaxParts` in `app/diff/spans.ts`).
- Unknown extensions render as plain text.
