# Session 63

## Issue #123 revisit: mobile deck swipe touch-action conflict

### Diagnosis

The commit `051e591` ("Fix mobile deck swipe transitions") added touch-aware
gesture resolution, proper next-card backing, and `touchAction: "pan-y"` on
the draggable `motion.div` in `feed-deck.tsx`, but the swipe still failed on
real touch devices: the card position reset to centre immediately.

A CDP-based browser reproduction at 393×851 confirmed the sequence:

```
pointerdown → pointermove (x2) → pointercancel → …
```

The browser emits `pointercancel` because the effective `touch-action` for the
touch point is computed per CSS spec from the target up to and including the
**nearest scroll container**.  The `div.overflow-y-auto` inside `PaperCard`
(with default `touch-action: auto`) is that scroll container, and the
`<article>` with `overflow: hidden` is also a scroll container for touches
that start outside the abstract.  The `touch-action: pan-y` on the outer
`motion.div` is beyond the nearest scroll container, so it never influences
the browser's gesture arbitration.

### Fix

`src/components/paper-card.tsx` — two inline `style` additions:

- `<article>`: `style={{ touchAction: "pan-y" }}`
- `<div className="flex-1 overflow-y-auto …">`: `style={{ touchAction: "pan-y" }}`

`pan-y` tells the browser it may handle vertical panning (native scroll)
but must leave horizontal panning to JavaScript, letting framer-motion `drag`
receive the gesture.  The existing `touchAction: "pan-y"` on the `motion.div`
in `feed-deck.tsx` is kept as belt-and-suspenders.

### Validation

- `npm run typecheck` — passed
- `npm run lint` — passed
- `npm run test:unit` — 114/114 passed
- `TMPDIR=/tmp npm run build` — passed

No commits yet; awaiting real-device confirmation.

Real-device test confirmed the fix works.

## README and ROADMAP cleanup

- README: bumped version to 0.1.5, corrected swipe right behaviour (save to
  Read later, not open detail), extracted product principles from ROADMAP
  (3-minute daily triage loop, free-first, privacy), removed redundant
  `.env.local` variable listing, updated repository layout tree.
- ROADMAP: cut from 1,091 to 559 lines (-49%). Removed completed Fasi di
  sviluppo (0–8), detailed Fonti dati candidate (→ README summary), Gestione
  LaTeX (→ README), Modello dati iniziale (→ docs/database.md), Componenti
  principali (duplicate), expanded Architettura (→ docs/architecture.md),
  Rischi e decisioni risolte, Fondazione identità/notifiche (implementation
  detail). Fixed contradictions: note personali (implemented, not post-MVP),
  embeddings active in ranking, swipe right behaviour.

## Docs audit and fixes

- `AGENTS.md`: updated `src/proxy.ts` description to reflect resource-level
  guards (`requireOwnerId`/`requireUserContext`) as the authorization boundary.
- `docs/deployment.md`: bumped verification date to 2026-08-04.
- `docs/clerk-supabase-rls.md`: step 3 checkbox updated to reflect partial
  migration progress; stale `@user-scoped`/`@admin` counts annotated.
- `docs/social-interactions-plan.md`: status updated from "proposta" to
  "fondazioni implementate, feature proposte ma non rilasciate".
- `docs/database.md`: resolved contradictory paragraphs about RPC migration
  deployment status by adding clarifying heading.
- `docs/research-group-charter.md`: corrected in-app RPC deployment status
  (deployed but guarded by database switches).
- `docs/ingestion.md`: clarified Unpaywall OA URL count (21 initial vs 24
  after subsequent enrichment in ROADMAP).
- `docs/mobile-swipe-diagnosis.md`: technical analysis of the touch-action
  conflict written and committed.

## Validation

- `npm run typecheck` — passed
- `npm run lint` — passed
- `npm run test:unit` — 114/114 passed
- `TMPDIR=/tmp npm run build` — passed
