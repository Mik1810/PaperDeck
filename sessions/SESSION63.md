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
