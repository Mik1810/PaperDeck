# PaperDeck — Issues rimanenti

Generato il 2026-07-06. Aggiornato dopo SESSION 18 (16 issue chiuse).

---

## 1. HIGH — Performance

### 1.1 Query catalog che caricano embedding e triage summary

**File:** `src/lib/repositories/catalog.ts:80-82, 141`

`.select()` senza colonne esplicite carica `embedding` (384-dim vector) e `triageSummary` (jsonb) in ogni query, inclusa `getAllPapers()`. Impatto significativo sul payload di ogni feed load.

**Fix:** selezionare solo le colonne necessarie con `select({ id: papers.id, title: papers.title, ... })`.

### 1.2 Query sequenziali invece di parallele

**File:** `src/lib/repositories/catalog.ts:80-96`

`getPapersByIds` esegue tre query in serie (papers → authors → topics). Possono essere parallelizzate con `Promise.all` per un ~2x speedup.

### 1.3 N UPDATE sequenziali nel riordinamento playlist

**File:** `src/lib/repositories/playlist-items.ts:80-90`

`reorderOwnedPlaylistItems` esegue N UPDATE individuali. Per 50 item = 50 round trip. Usare un batch update o una singola transazione SQL.

---

## 2. HIGH — CI e Test

### 2.1 Test auth sempre skippati in CI

**File:** `tests/e2e/auth-smoke.spec.ts`, `.github/workflows/ci.yml:18-19`

I test di autenticazione sono condizionati da `!PAPERDECK_E2E_DEV_AUTH`, ma in CI `PAPERDECK_E2E_DEV_AUTH=true` è sempre attivo. I test non vengono mai eseguiti.

### 2.2 Nessun test per l'algoritmo di ranking

**File:** `src/lib/ranking/feed-ranking.ts` (212 linee)

Il core ranking algorithm non ha test. Qualsiasi modifica ai pesi o alla logica è non validata.

### 2.3 Nessun test per `semantic-retrieval.ts`

Il path di retrieval semantico (pgvector match_papers_by_embedding) non ha test.

### 2.4 Cleanup incompleto nei test E2E

**File:** `tests/e2e/app-smoke.spec.ts:38-40`

`resetDevOwner()` cancella `profiles WHERE owner_id = ...` ma non pulisce le righe correlate in `playlists`, `user_interests`, `user_paper_interactions`, `user_profile_embeddings`, `recommendations`. Fallimenti lasciano il DB sporco.

---

## 3. MEDIUM — Qualità codice

### 3.1 Duplicazione massiva nei 6 script TS

`loadLocalEnv()` (~20 linee), `requireEnv()`, `createSupabaseClient()` sono copia-incollati in:
- `scripts/ingest-arxiv.ts`
- `scripts/enrich-semantic-scholar.ts`
- `scripts/enrich-openalex.ts`
- `scripts/enrich-unpaywall.ts`
- `scripts/discover-classic-papers.ts`
- `scripts/generate-summaries.ts`

**Fix:** estrarre in `scripts/lib/env.ts` condiviso.

### 3.2 Magic numbers nel ranking

**File:** `src/lib/ranking/feed-ranking.ts:125-145`

17 numeri magici (`120`, `90`, `6`, `2`, `0.4`, `8`, `12`, `18`, `-5`, `-7`, `2020`, `0.75`, `0.5`). Dovrebbero essere costanti nominate e configurabili.

### 3.3 `match_papers_by_embedding` — unsafe type cast

**File:** `src/lib/repositories/semantic-retrieval.ts:73`

Doppio cast che bypassa il type system. Il tipo `SemanticMatchRow` dichiara `paper_id: string` ma la funzione RPC restituisce `uuid`.

### 3.6 Input non validato in API route

**File:** `src/app/api/deck/route.ts:12`

`const body = (await request.json()) as Record<string, string>` — nessuna validazione con Zod.

### 3.7 `generate-summaries.yml` — nome secret inconsistente

**File:** `.github/workflows/generate-summaries.yml:52`

Usa `secrets.GH_MODELS_TOKEN` ma la variabile documentata è `GITHUB_MODELS_TOKEN`.

### 3.8 `requirePaperId()` usato per ID non-paper

**File:** `src/app/actions.ts:31,189,202`

La funzione `requirePaperId(formData)` viene riutilizzata per estrarre `playlistId` in `renamePlaylistAction` e `deletePlaylistAction`. Il nome è fuorviante.

**Fix:** rinominare in `requireId()`.

---

## 4. MEDIUM — Accessibilità

### 4.2 Test dinamici con `for` loop

**File:** `tests/e2e/app-smoke.spec.ts:229`

Generazione dinamica di test con `for` loop — in modalità `fullyParallel`, l'ordinamento non è deterministico.

---

## 5. MEDIUM — Configurazione

---

## 6. MEDIUM — Documentazione

### 6.2 `embeddings.md` — riferimento a commit/run specifici

**File:** `docs/embeddings.md:94`

Riferimenti a commit `e001b6d` e run `28576306513` — dettagli che invecchieranno male.

### 6.3 `clerk-supabase-rls.md` — passaggio 3 non tracciato

**File:** `docs/clerk-supabase-rls.md:58`

Il passaggio "transition user-scoped functions to clerk-authenticated client" non ha task in TASKS.md. Issue #47 copre ma è risolta solo a livello di documentazione/audit.

---

## 7. LOW — Miglioramenti minori

| # | File | Problema |
|---|------|----------|
| 1 | `src/lib/repositories/catalog.ts:37` | `row.year ?? new Date().getFullYear()` — anno mancante diventa anno corrente |
| 2 | `src/lib/render-latex.ts` | Nessun escape HTML per contenuto non-LaTeX |
| 3 | `src/lib/client/deck-mutations.ts:39` | Nessun timeout sulla fetch — UI bloccata su rete lenta |
| 4 | `src/lib/repositories/semantic-retrieval.ts:86-88` | Query profilo embedding non filtra per `embeddingModel` |
| 5 | `src/types/paper.ts:68` | `"seen"` in `InteractionType` non usato |
| 6 | `src/components/feed-deck.tsx` | Percentuali mix hardcodate, non derivate dal ranking reale |
| 7 | `src/lib/logging/logger.ts` | Nessun sampling per eventi ad alto volume |
| 8 | `supabase/migrations` | `get_table_sizes()` in migration ma non in `schema.sql` |
| 9 | `supabase/schema.sql` | Nessun trigger `on update now()` per `profiles.updated_at` e `playlists.updated_at` |
| 10 | `scripts/review_triage_summaries.py:564` | Prompt in italiano in app altrimenti inglese |
| 11 | `scripts/generate-summaries.ts:666,672` | URL API e versione GitHub Models hardcodati |
| 12 | `scripts/discover-classic-papers.ts:91-241` | 151 linee di profili discovery hardcodati in TS |
| 13 | `src/lib/auth/session.ts:22,41` | `throw new Error("Unauthenticated")` dopo `redirectToSignIn()` è dead code |
