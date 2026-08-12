# Session 88

## Issue #180: canonical private-playlist membership mutations

### Scope and decisions

- Replaced the parallel Read later, picker, inline-create, and Library
  membership implementations with one `setPlaylistMembership` service.
- Kept explicit target-state semantics: duplicate ON and OFF requests are
  no-ops, while each real OFF-to-ON transition appends one interaction.
- The service resolves or provisions the target playlist, locks its row,
  allocates `max(position) + 1`, changes membership, and records the interaction
  in one short transaction. A profile refresh is scheduled only after a real
  state change.
- Feed, digest, paper detail, group `Save privately`, quick Read later, inline
  playlist creation, and Library removal all reach the same implementation.
- Removed the unused legacy Library add action and the lower-level add/remove
  repository pair. Manual reordering remains a separate ordered-list operation.
- Reused `playlist_items_order_idx`; an explicit local plan check confirmed a
  backward index-only scan for the max-position lookup, so no duplicate schema
  migration was needed.

### Regression evidence

- Two concurrent quick Read later ON requests produce one membership and one
  interaction; one reports a real change and the duplicate reports a no-op.
- ON, duplicate ON, OFF, duplicate OFF, and re-add preserve one final row and
  append exactly two save interactions.
- A playlist with position 7 assigns position 8 to the new membership, and the
  duplicate request does not move it.
- Two different concurrent additions to that playlist receive distinct,
  consecutive positions 9 and 10 under the playlist-row lock.
- A paper created and saved through the detail picker can be removed through
  Library without adding an interaction, then re-added through the picker with
  one new interaction and the canonical position.
- Static wiring regressions cover the shared picker on feed, digest, detail,
  and group surfaces, the quick Read later route, Library removal, and inline
  playlist creation.

### Safety

- Server actions continue to derive the owner from the authenticated session;
  playlist lookups include that owner and lock only the authorized playlist.
- Server action UUID inputs are validated before the Library removal reaches
  the repository.
- No hosted Supabase database, shared data, credential, or environment value
  was read or modified. Database tests used loopback `paperdeck_test` only.

### Validation

- Focused canonical-wiring unit tests (3 passed)
- Focused mutation E2E (6 passed across desktop and mobile)
- Full mutation E2E file (34 passed across desktop and mobile)
- Post-review concurrent Read later regression (2 passed across desktop and mobile)
- Full unit suite (149 passed)
- Local query plan: backward index-only scan on `playlist_items_order_idx`
- `npm run typecheck`
- Full ESLint
- `TMPDIR=/tmp npm run build`
- `git diff --check`
