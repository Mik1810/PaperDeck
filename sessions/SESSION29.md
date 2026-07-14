# Session 29 — Issue #87: arXiv LaTeX delimiters

## Problem

`renderLatex()` only recognized `$...$` and `$$...$$` with an `indexOf()`
scanner. Common arXiv delimiters (`\\(...\\)` and `\\[...\\]`) remained visible,
escaped dollars could be consumed as math, and unbalanced openers made the
parser fragile across titles, abstracts, search, digest, playlists, and notes.

## Changes

- Replaced the dollar-only scanner with a delimiter-aware linear tokenizer.
- Added inline support for `$...$` and `\\(...\\)` and display support for
  `$$...$$` and `\\[...\\]`, with longer delimiters taking precedence.
- Treated `\\$` as a literal dollar and ignored escaped delimiter candidates.
- Preserved unmatched openers as text while allowing later valid expressions
  to render.
- Kept all non-KaTeX content behind the existing HTML escaping boundary and
  centralized KaTeX rendering options in one helper.
- Added eight unit regressions for delimiters, mixed fragments, escaped dollars,
  escaped delimiter-like text, unbalanced input, recovery, and HTML safety.

## Validation

- Focused LaTeX unit tests: 8 passed.
- `npm run test:unit`: 56 passed.
- `npm run lint` and `npm run typecheck`: passed.
- `npm run build` with Node 22: passed.
- Playwright Pixel 5 feed smoke: 1 passed.

## Scope

- No schema migration or new dependency.
- No Markdown, custom macro, or full LaTeX-environment support was added.
- Currency-like unescaped dollars remain intentionally outside this issue's
  deterministic delimiter rules.
