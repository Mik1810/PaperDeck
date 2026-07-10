# Session 25 — Piano di sviluppo delle interazioni sociali

## Obiettivo

Trasformare la GitHub issue #37, finora un guardrail post-MVP molto ampio, in un piano di sviluppo concreto e ordinato senza iniziare ancora a rendere pubblici dati o superfici dell'app.

## Decisioni di pianificazione

- PaperDeck resta un daily CS triage deck; le interazioni sociali servono prima a piccoli gruppi di ricerca, non a creare una rete sociale generalista.
- Il percorso e' sequenziale: core recommendation stabile -> share di metadati -> follow privati -> collection invite-only -> discussione interna -> unlisted/pubblico opt-in -> eventuale UGC/social graph solo dopo un nuovo go/no-go.
- Nessun segnale sociale deve entrare di default in ranking, embedding, `favorites`, `Read later` o note private.
- Le playlist e note attuali restano owner-only. La collaborazione futura usa un dominio separato con ACL, membership, inviti hashati e RLS verificata.
- Un profilo pubblico futuro non puo' riusare `profiles.display_name`, poiche' oggi puo' derivare dall'email Clerk.

## File aggiunti e aggiornati

- `docs/social-interactions-plan.md`: piano completo dalla fase di charter e stabilizzazione fino a collection condivise, moderazione e decisione sul social graph.
- `CHANGELOG.md`: annotato il nuovo piano di sviluppo.
- `sessions/SESSION25.md`: questa nota di sessione.

## Validazione

- Verificata l'aderenza del piano ai guardrail privacy-first e free-first.
- Verificato il modello attuale: dati user-scoped owner-only, RLS Clerk ancora non attiva nel normale percorso applicativo e note esplicitamente private.
- Nessun codice runtime, migration, dato Supabase o issue GitHub e' stato modificato in questa sessione.
