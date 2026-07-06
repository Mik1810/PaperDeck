# PaperDeck — Analisi critica, bug e miglioramenti

Generato il 2026-07-06. Basato su scansione completa del repository, 19 issue aperte su GitHub e analisi di tutti i file sorgente, test, CI, docs e schema DB.

---

## 1. CRITICAL — Sicurezza e data integrity

### 1.1 RLS policy su `profiles` incomplete (Drizzle ORM)

**File:** `src/db/schema.ts:17-19`

Le policy `profiles_select_own` e `profiles_update_own` sono definite senza clausola `using`/`withCheck`. Questo significa che, se `drizzle-kit push` viene eseguito, qualsiasi utente autenticato può leggere e modificare **ogni** riga della tabella `profiles`.

- `profiles_select_own`: nessun `using` → tutti leggono tutto
- `profiles_update_own`: nessun `using` né `withCheck` → tutti modificano tutto

**Fix:** aggiungere `using(sql`owner_id = auth.jwt() ->> 'sub'`)` e `withCheck` alle due policy in `schema.ts` allineandole a `schema.sql`.

### 1.2 `ingestion_runs` e `ingestion_cursors` senza policy RLS

**File:** `src/db/schema.ts:184-193`, `src/db/schema.ts:378-395`, `supabase/schema.sql:279`

Entrambe le tabelle hanno RLS abilitato ma **zero policy**. Le operazioni tramite anon/authenticated role sono bloccate (default deny). Attualmente sono accessibili solo via service-role, ma il comportamento è fragile: un refactor che usi il client autenticato per una query amministrativa fallirebbe silenziosamente.

**Fix:** documentare esplicitamente nel codice e nei docs che queste tabelle sono service-role only, o aggiungere policy per il ruolo `service_role`.

### 1.3 Leak di errori interni nelle API response

**File:** `src/app/api/deck/route.ts:50`

```typescript
return Response.json({ success: false, error: error.message }, { status: 500 })
```

`error.message` viene esposto al client. In produzione, restituire un messaggio generico.

**Fix:** `error: "Internal error"` in produzione, dettaglio solo in development.

### 1.4 Mancanza di `noopener` nei link esterni

**File:** `src/components/paper-card.tsx:211`

`rel="noreferrer"` senza `noopener` permette alla pagina target di accedere a `window.opener`.

**Fix:** `rel="noreferrer noopener"`.

---

## 2. HIGH — Bug funzionali

### 2.1 Stato ottimistico non sincronizzato con le props

**File:** `src/components/paper-card.tsx:41-42`, `src/components/playlist-papers.tsx:29`

`useState(isFavorite)` e `useState(isSaved)` sono inizializzati dalle props ma **mai aggiornati** quando le props cambiano. Se l'utente naviga e torna indietro dopo una `revalidatePath`, lo stato locale sovrascrive lo stato server aggiornato.

**Fix:** aggiungere `useEffect` per sincronizzare lo stato locale con le props:
```typescript
useEffect(() => setOptimisticFavorite(isFavorite), [isFavorite]);
useEffect(() => setOptimisticSaved(isSaved), [isSaved]);
```

### 2.2 Race condition nella creazione playlist

**File:** `src/components/playlist-sidebar.tsx:48`

`onSubmit={() => setIsCreating(false)}` nasconde il form prima che la server action completi. Se la creazione fallisce, il form scompare senza feedback.

**Fix:** resettare `setIsCreating(false)` solo dopo successo della server action, o usare `useActionState`.

### 2.3 `match_papers_by_embedding` — modello di default errato

**File:** `supabase/schema.sql:404`

Il default della funzione è `'sentence-transformers/all-MiniLM-L6-v2'`, ma il ROADMAP specifica `BAAI/bge-small-en-v1.5`. La costante TypeScript in `user-profile-embeddings.ts:28` usa MiniLM. Tre fonti di verità in disaccordo.

**Fix:** allineare funzione SQL, costante TS e ROADMAP su un unico modello (probabilmente MiniLM dato che è usato in produzione).

### 2.4 Full page navigation invece di `next/link`

**File:** `src/components/playlist-sidebar.tsx:119-121`

Usa `<a href={...}>` raw invece di `<Link>` di Next.js, causando ricaricamenti completi della pagina nella navigazione tra playlist.

### 2.5 `requirePaperId()` usato per ID non-paper

**File:** `src/app/actions.ts:31,189,202`

La funzione `requirePaperId(formData)` viene riutilizzata per estrarre `playlistId` in `renamePlaylistAction` e `deletePlaylistAction`. Il nome della funzione è fuorviante.

**Fix:** rinominare in `requireId()` o creare funzioni separate.

---

## 3. HIGH — Performance

### 3.1 Query catalog che caricano embedding e triage summary

**File:** `src/lib/repositories/catalog.ts:80-82, 141`

`.select()` senza colonne esplicite carica `embedding` (384-dim vector) e `triageSummary` (jsonb) in ogni query, inclusa `getAllPapers()`. Impatto significativo sul payload di ogni feed load.

**Fix:** selezionare solo le colonne necessarie con `select({ id: papers.id, title: papers.title, ... })`.

### 3.2 Query sequenziali invece di parallele

**File:** `src/lib/repositories/catalog.ts:80-96`

`getPapersByIds` esegue tre query in serie (papers → authors → topics). Possono essere parallelizzate con `Promise.all` per un ~2x speedup.

### 3.3 N UPDATE sequenziali nel riordinamento playlist

**File:** `src/lib/repositories/playlist-items.ts:80-90`

`reorderOwnedPlaylistItems` esegue N UPDATE individuali. Per 50 item = 50 round trip. Usare un batch update o una singola transazione SQL.

### 3.4 Connection pooling: default 1 connessione

**File:** `src/db/index.ts:10`

`DATABASE_MAX_CONNECTIONS` default a 1. Su Vercel Serverless, una singola richiesta blocca tutte le altre chiamate DB nella stessa istanza. Per il tier gratuito di Supabase (~15-20 connessioni dirette) è troppo conservativo.

**Fix:** alzare il default a 3-5 o renderlo configurabile con documentazione.

### 3.5 Indici mancanti

| Tabella | Indice mancante | Query pattern |
|---------|-----------------|---------------|
| `user_paper_interactions` | `(owner_id, paper_id)` | Lookup in toggleFavorite, getPaperDetailState, dedup feed |
| `playlist_items` | `(playlist_id, added_at desc)` | Ordinamento per data in getPlaylistPapers |
| `ingestion_runs` | `(source, status)` | Trova run in corso per fonte |
| `ingestion_cursors` | `(source, cursor_key)` | PK copre ma non ottimale per filtro con `last_seen_published_at` |

Inoltre `user_paper_interactions` non ha **unique constraint** su `(owner_id, paper_id, interaction_type)` — ogni `recordPaperInteraction` inserisce incondizionatamente, creando possibili duplicati.

---

## 4. HIGH — CI e Test

### 4.1 Zero test su mobile viewport

**File:** `playwright.config.ts:52-53`

Solo `Desktop Chrome` a 1280x720. App mobile-first testata solo su desktop. Mancano `Pixel 5` o `iPhone 14`.

### 4.2 Test auth sempre skippati in CI

**File:** `tests/e2e/auth-smoke.spec.ts`, `.github/workflows/ci.yml:18-19`

I test di autenticazione sono condizionati da `!PAPERDECK_E2E_DEV_AUTH`, ma in CI `PAPERDECK_E2E_DEV_AUTH=true` è sempre attivo. I test non vengono mai eseguiti.

### 4.3 Nessun test per l'algoritmo di ranking

**File:** `src/lib/ranking/feed-ranking.ts` (212 linee)

Il core ranking algorithm non ha test. Qualsiasi modifica ai pesi o alla logica è non validata.

### 4.4 Nessun test per `semantic-retrieval.ts`

Il path di retrieval semantico (pgvector match_papers_by_embedding) non ha test.

### 4.5 Cleanup incompleto nei test E2E

**File:** `tests/e2e/app-smoke.spec.ts:38-40`

`resetDevOwner()` cancella `profiles WHERE owner_id = ...` ma non pulisce le righe correlate in `playlists`, `user_interests`, `user_paper_interactions`, `user_profile_embeddings`, `recommendations`. Fallimenti lasciano il DB sporco.

### 4.6 `concurrency` group assente in tutti i workflow CI

Due `workflow_dispatch` simultanei dello stesso workflow possono corrompere cursori di ingestion o duplicare embedding.

**Fix:** aggiungere `concurrency: ${{ github.workflow }}-${{ github.ref }}` a ogni workflow.

---

## 5. MEDIUM — Qualità codice

### 5.1 Duplicazione massiva nei 6 script TS

`loadLocalEnv()` (~20 linee), `requireEnv()`, `createSupabaseClient()` sono copia-incollati in:
- `scripts/ingest-arxiv.ts`
- `scripts/enrich-semantic-scholar.ts`
- `scripts/enrich-openalex.ts`
- `scripts/enrich-unpaywall.ts`
- `scripts/discover-classic-papers.ts`
- `scripts/generate-summaries.ts`

**Fix:** estrarre in `scripts/lib/env.ts` condiviso.

### 5.2 Magic numbers nel ranking

**File:** `src/lib/ranking/feed-ranking.ts:125-145`

17 numeri magici (`120`, `90`, `6`, `2`, `0.4`, `8`, `12`, `18`, `-5`, `-7`, `2020`, `0.75`, `0.5`). Dovrebbero essere costanti nominate e configurabili.

### 5.3 `match_papers_by_embedding` — unsafe type cast

**File:** `src/lib/repositories/semantic-retrieval.ts:73`

```typescript
return (result as unknown as SemanticMatchRow[]) ?? [];
```

Doppio cast che bypassa completamente il type system. Il tipo `SemanticMatchRow` dichiara `paper_id: string` ma la funzione RPC restituisce `uuid`.

### 5.4 `paperFromRow` dichiarato `async` senza `await`

**File:** `src/lib/repositories/catalog.ts:26-30`

La funzione è marcata `async` ma non usa mai `await`. Restituisce `Promise.resolve(...)` implicitamente. Rimuovere `async` o renderla genuinamente asincrona.

### 5.5 `render-latex.ts` non supporta display math `$$...$$`

**File:** `src/lib/render-latex.ts:3-54`

Supporta solo `$...$` inline. `$$...$$` (equazioni in blocco) sono comuni negli abstract CS e verranno renderizzate come testo raw.

### 5.6 Input non validato in API route

**File:** `src/app/api/deck/route.ts:12`

```typescript
const body = (await request.json()) as Record<string, string>;
```

Nessuna validazione con Zod. Il body potrebbe contenere array, oggetti annidati, o tipi inattesi.

### 5.7 `generate-summaries.yml` — nome secret inconsistente

**File:** `.github/workflows/generate-summaries.yml:52`

Usa `secrets.GH_MODELS_TOKEN` ma la variabile d'ambiente documentata è `GITHUB_MODELS_TOKEN`. Il fallback tra `GITHUB_TOKEN` e il token custom è rotto.

---

## 6. MEDIUM — Accessibilità

### 6.1 `aria-label` su icona invece che su button

**File:** `src/components/paper-card.tsx:156,172-179,181,197-204`

`aria-label` è sull'elemento `<Heart>` e `<Bookmark>`, ma i `<button>` wrapper non hanno label. Screen reader annunciano pulsanti ambigui.

**Fix:** spostare `aria-label` sul `<button>`.

### 6.2 Test dinamici con `for` loop

**File:** `tests/e2e/app-smoke.spec.ts:229`

Generazione dinamica di test con `for` loop — in modalità `fullyParallel`, l'ordinamento non è deterministico e un fallimento non identifica chiaramente quale iterazione è fallita.

---

## 7. MEDIUM — Documentazione e coerenza

### 7.1 ROADMAP dice MathJax, il codice usa KaTeX

**File:** `ROADMAP.md:92,374`

"MathJax 3: rendering LaTeX" ma `grep` conferma zero riferimenti a MathJax nel codice. Il progetto usa KaTeX. Il ROADMAP è fuorviante.

### 7.2 CHANGELOG `[Unreleased]` contiene lavoro già rilasciato

**File:** `CHANGELOG.md:9-61`

52 righe di modifiche nella sezione `[Unreleased]` che sono state effettivamente rilasciate nella 0.1.4.

### 7.3 TASKS.md — task di product positioning P0 non affrontati

**File:** `TASKS.md:9-48`

I task di riposizionamento ("triage deck" invece di "generalist research suite") sono tutti unchecked. Il README e ROADMAP non riflettono il posizionamento discusso.

### 7.4 Modello embedding inconsistente tra docs, codice e SQL

- `ROADMAP.md`: `BAAI/bge-small-en-v1.5`
- `user-profile-embeddings.ts:28`: `sentence-transformers/all-MiniLM-L6-v2`
- `match_papers_by_embedding` SQL default: `sentence-transformers/all-MiniLM-L6-v2`

Tre fonti di verità in disaccordo.

### 7.5 `clerk-supabase-rls.md` — passaggio 3 non tracciato

**File:** `docs/clerk-supabase-rls.md:58`

Il passaggio "transition user-scoped repository functions from service role to clerk-authenticated client" è unchecked e non ha task corrispondente in TASKS.md. Issue #47 lo copre ma non è risolta.

### 7.6 `embeddings.md` — riferimento a commit/run specifici

**File:** `docs/embeddings.md:94`

Riferimenti a commit `e001b6d` e run `28576306513` — dettagli di implementazione che invecchieranno male.

---

## 8. MEDIUM — Configurazione

### 8.1 `next.config.ts` quasi vuoto — header di sicurezza assenti

**File:** `next.config.ts`

Mancano:
- `Content-Security-Policy`
- `Strict-Transport-Security`
- `X-Content-Type-Options`
- `X-Frame-Options`
- `Referrer-Policy`
- `poweredByHeader: false`

### 8.2 `tsconfig.json` target ES2017

**File:** `tsconfig.json:3`

ES2017 manca di `Promise.allSettled`, optional chaining in output, e `globalThis`. Portare a ES2020+.

### 8.3 Nessuno script `typecheck` o `test` nel package.json

`npm test` fallisce. Solo `test:unit` e `test:e2e` esistono. Manca `tsc --noEmit` dedicato.

### 8.4 Hardcoded fallback Clerk keys in CI

**File:** `.github/workflows/ci.yml:18-19`

`pk_test_replace_me` e `sk_test_replace_me` come fallback. Meglio usare stringhe vuote.

---

## 9. LOW — Miglioramenti minori

| # | File | Problema |
|---|------|----------|
| 1 | `src/lib/repositories/catalog.ts:37` | `row.year ?? new Date().getFullYear()` — anno mancante diventa anno corrente, indistinguibile da paper 2026 reale |
| 2 | `src/lib/render-latex.ts` | Nessun escape HTML per contenuto non-LaTeX prima del render |
| 3 | `src/lib/client/deck-mutations.ts:39` | Nessun timeout sulla fetch — UI bloccata indefinitamente se la rete è lenta |
| 4 | `src/lib/repositories/semantic-retrieval.ts:86-88` | Query profilo embedding non filtra per `embeddingModel` |
| 5 | `src/types/paper.ts:68` | `"seen"` in `InteractionType` non usato da nessuna parte |
| 6 | `src/components/feed-deck.tsx` | Percentuali mix ("65% Relevant, 20% Explore, 15% Classics") hardcodate, non derivate dal ranking reale |
| 7 | `src/lib/logging/logger.ts` | Logger strutturato ma nessun sampling per eventi ad alto volume |
| 8 | `supabase/migrations` | `get_table_sizes()` presente nella migration ma assente in `schema.sql` consolidato |
| 9 | `supabase/schema.sql` | Nessun trigger `on update now()` per `profiles.updated_at` e `playlists.updated_at` |
| 10 | `src/lib/repositories/catalog.ts:26` | `paperFromRow` dichiarato `async` senza `await` |
| 11 | `scripts/review_triage_summaries.py:564` | Prompt in italiano ("Decisione [o/w/s/q]") in un'app altrimenti inglese |
| 12 | `scripts/generate-summaries.ts:666,672` | URL API e versione GitHub Models hardcodati |
| 13 | `scripts/discover-classic-papers.ts:91-241` | 151 linee di profili di discovery hardcodati in TS invece che in JSON/YAML |
| 14 | `src/lib/auth/session.ts:22,41` | `throw new Error("Unauthenticated")` dopo `redirectToSignIn()` è dead code |

---

## 10. Riepilogo issue aperte pertinenti

Delle 19 issue aperte, le seguenti hanno overlap diretto con i problemi trovati:

| Issue | Titolo | Sovrapposizione |
|-------|--------|-----------------|
| #42 | Refresh semantic user profile embeddings after feedback writes | Bug — il profilo non viene aggiornato dopo i feedback (sezione 2.x) |
| #44 | Add authorization and mutation regression tests | Mancano test per API route e mutation (sezione 4.3-4.5) |
| #45 | Implement a Markdown-to-GitHub-issues importer | Devex — tooling mancante |
| #47 | Split admin/batch repositories from user-scoped RLS repositories | Architettura — RLS enforcement da completare (sezione 1.1-1.2) |
| #48 | Rollback and visible errors for optimistic mutations | Bug — race condition e stato non sincronizzato (sezione 2.1-2.2) |
| #49 | Make the feed deck paginated | Performance — solo 4 paper nella coda (sezione 3.x) |
| #51 | Harden ingestion with retry/backoff | Robustezza — script senza retry (sezione 5.x) |
| #52 | Add recommendation analytics beyond raw interactions | Analytics — nessun tracciamento ranking (sezione 4.3) |
| #54 | Make the feed deck feel more Tinder-like | UX — deck UI da migliorare |

---

## 11. Raccomandazioni prioritarie

### Quick win (1-2 ore ciascuno)

1. **Fix RLS `profiles` policy** in `schema.ts` (CRITICAL — security)
2. **Aggiungere `noopener`** al link esterno in `paper-card.tsx`
3. **Sincronizzare stato ottimistico** con `useEffect` in `paper-card.tsx` e `playlist-papers.tsx`
4. **Sostituire `<a>` con `<Link>`** in `playlist-sidebar.tsx`
5. **Nascondere error message** in produzione nella route `/api/deck`
6. **Aggiungere `concurrency` group** ai 5 workflow CI

### Medio termine (1-3 giorni ciascuno)

7. **Risolvere issue #42**: refresh profilo embedding dopo feedback
8. **Risolvere issue #49**: feed paginato invece di soli 4 paper
9. **Estrarre `loadLocalEnv`** in modulo condiviso per gli script
10. **Aggiungere test per `feed-ranking.ts`**
11. **Aggiungere viewport mobile** nei test Playwright
12. **Allineare modello embedding** tra SQL, TS e ROADMAP

### Lungo termine

13. **Issue #47**: completare migrazione a Clerk-authenticated client per query utente
14. **Issue #44**: test di autorizzazione e regressione sulle mutation
15. **Issue #52**: analytics sulle raccomandazioni
16. **Aggiornare `next.config.ts`** con security headers e configurazione immagini
17. **Aggiungere indici mancanti** su `user_paper_interactions`, `playlist_items`, `ingestion_runs`
