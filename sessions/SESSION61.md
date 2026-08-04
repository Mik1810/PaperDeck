# Session 61

## Issue #123: mobile deck swipe reliability

- Reproduced the reported mobile behavior from the supplied recording: the
  active paper exited over an empty backing surface before the next paper
  appeared, while the fixed gesture threshold made shorter phone swipes feel
  unresponsive.
- Replaced the fixed 100 px / 500 px/s decision with a tested viewport-aware
  gesture resolver. Deliberate distance swipes and short intentional flicks
  commit, while tiny, short, or predominantly vertical gestures snap back.
- Disabled Motion's automatic drag momentum and use one bounded tween for the
  exit, avoiding competition between automatic and manual animation state.
- Render the actual next `PaperCard` beneath the active card before the gesture
  begins. The backing card is inert, hidden from assistive technology, and
  cannot receive pointer input.
- Reset the draggable layer by paper identity, preserve the existing optimistic
  dismiss/Read later behavior and exact rollback, and honor reduced-motion
  preferences.

## Token boundary decision

- Kept research-group invitation tokens limited to external invitation links.
- Agreed that the future notification inbox should use a separate authenticated,
  server-only recipient action that checks recipient ownership, pending state,
  expiry, and the relevant feature switch. Invitation tokens must not be stored
  in notification records or exposed to the notification UI.
- No notification or token implementation changed in this session.

## Validation

- `npm run typecheck`
- `npm run lint`
- `npm run test:unit` (110 passed)
- `TMPDIR=/tmp npm run build`
- Agent-browser verification at 390x844 using the real `FeedDeck` with synthetic
  local-only papers and a no-write mutation stub: short swipe snap-back, failed
  mutation rollback, two consecutive successful swipes in opposite directions,
  real next-card content before advancement, and no horizontal overflow.
- The temporary verification route and browser session were removed after the
  checks; no local or remote database data was read or modified.
