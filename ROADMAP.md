# PaperDeck ROADMAP

Ultimo aggiornamento: 2026-07-18

## Visione

PaperDeck e' una webapp mobile-first per scoprire articoli di informatica in base ai propri interessi accademici.

L'esperienza iniziale deve assomigliare piu' a un feed decisionale che a un motore di ricerca classico: l'utente vede una card alla volta, legge titolo e abstract, poi indica se il paper e' interessante o no. Il sistema usa queste scelte per migliorare progressivamente le raccomandazioni.

L'obiettivo non e' sostituire Google Scholar, arXiv o Semantic Scholar. L'obiettivo e' ridurre il rumore e proporre paper rilevanti, con link affidabili per leggerli altrove.

## Decisioni gia' prese

- Nome prodotto consigliato: `PaperDeck`.
- Nome repository consigliato: `paperdeck`; fallback se non disponibile: `cs-paperdeck`.
- Repository GitHub: pubblico.
- Licenza repository: MIT per codice sorgente e documentazione.
- Dominio iniziale: solo informatica.
- Lingua abstract: inglese, almeno nella prima versione.
- Traduzione/riassunto in italiano: rimandati a una fase successiva.
- Autenticazione: Clerk con login Google.
- Playlist: private nella prima versione.
- Lettura articolo: apertura del paper o della landing page in una nuova scheda/browser, anche da iPhone.
- Ranking iniziale: massima aderenza agli interessi dell'utente, non pura popolarita'.
- Stabilita' ranking: ranker e fixture sono versionati; qualita', copertura, sovrapposizione e latenza devono superare il gate offline in CI prima di ampliare le feature sociali.
- Il primo feed puo' includere anche paper classici/storici, non solo paper recenti.
- Swipe left significa "non mi interessa questo paper", non "rimuovi questo topic dai miei interessi".
- Gli interessi scelti in onboarding restano modificabili dalle impostazioni.
- UX principale: social-like, con feed/deck swipe-style.
- Onboarding interessi: wizard guidato separato dalla shell autenticata, minimale e scuro, con preferenze dominanti e controlli in una rail piu' stretta.
- Feed deck: una card singola full-screen.
- Swipe right salva il paper in Read later.
- Preferiti e swipe sono segnali diversi: cuore per preferiti, segnalibro per playlist.
- Abstract nella card: preview ellipsata, espandibile stile descrizione post social, con scroll verticale nella card.
- Search MVP: tab autenticata per cercare nel catalogo CS locale per titolo, autore, topic e identificativi, senza diventare una ricerca universale tipo reference manager.
- Aprire il dettaglio e' un segnale positivo leggero per il ranking.
- Segnalibro: apre un picker multi-selezione per le playlist private, con
  `Read later` in cima e creazione inline; lo swipe rapido continua a salvare
  direttamente in `Read later`.
- Preview abstract: circa 10 righe su mobile, adattiva su desktop.
- Embeddings MVP: modello open-source locale, con `sentence-transformers/all-MiniLM-L6-v2` come default corrente dopo benchmark offline; BGE-small resta baseline storica.
- Worker batch online MVP: GitHub Actions giornaliero e avviabile manualmente.
- Database online MVP: Supabase Postgres + pgvector.
- Supabase region: preferire `eu-central-2` Zurich se disponibile, fallback `eu-central-1` Frankfurt.
- Paper classici: massimo indicativo 10-15% del feed.
- Digest: solo in-app nella prima versione.
- Note personali: post-MVP.
- Collaborazione post-MVP: piccoli gruppi di ricerca privati, ciascuno con una sola lista condivisa di paper; solo owner/admin invitano membri e ogni invito richiede accettazione.
- Discovery collaborativa: ricerca account tramite email esatta disattivata di default e attivabile esplicitamente; amicizie reciproche con cooldown di 30 giorni dopo un rifiuto e nessun social graph pubblico.
- Ownership gruppi: successore scelto dall'owner, altrimenti admin attivo piu' anziano, poi membro attivo piu' anziano; gruppo eliminato solo se non esistono altri membri.
- Fondazione gruppi: dominio `research_groups` separato dalle playlist private, membership come unica fonte dell'owner, ACL centralizzata e kill switch database-backed per letture/scritture.
- Inviti gruppi: token casuale a uso singolo con scadenza di sette giorni, solo digest nel database, accettazione esplicita e controlli transazionali su ruolo, opt-in, policy, amicizia e blocchi; #96 applicata e verificata sul Supabase condiviso, con funzionalita' ancora disabilitata dai kill switch.
- Chiusura account Clerk: il webhook verificato usa una sola RPC service-role transazionale per completare successione/rimozione membership prima di eliminare l'identita' collaborativa; migrazione, gate sintetico e deployment Production sono verificati sul progetto Supabase condiviso.
- Notifiche collaborative: inbox durevole in-app con badge `99+`, menu degli ultimi 20 eventi, azioni inline e futura cronologia completa; eventi realtime accelerano la UI ma non sostituiscono Postgres.
- Discussione nei gruppi: possibile chat interattiva collegata ai paper, da progettare separatamente prima di qualsiasi implementazione.
- Tassonomia interessi: derivata dalle fonti disponibili, poi curata e normalizzata dentro l'app.
- Vincolo economico: approccio free-first, evitando servizi a pagamento finche' possibile.
- Caching layer: resta basato su Postgres (tabella `recommendations`, TTL 5 minuti). Redis/KV esterni sono rinviati fino al superamento di threshold definiti (catalogo >100k, GET /feed p95 >2s, QPS sostenuto oltre limiti free tier). Il preferred path post-threshold e' Next.js cache built-in prima di valutare servizi esterni.

## Stato implementazione

Aggiornato al 2026-08-04:

- Repository, scaffold Next.js, UI skeleton e Clerk auth: completati.
- Supabase schema iniziale con pgvector, RLS preparata e tabelle MVP: applicato.
- Deploy production su `https://paperdeck.michaelpiccirilli.it/`: completato.
- Clerk production, DNS, SSL e Google OAuth: completati e verificati.
- Primo layer di persistenza server-side: implementato.
  - Il catalogo seed di topic/paper viene salvato in Supabase.
  - Il profilo utente viene creato/aggiornato a partire da Clerk.
  - La playlist privata default `Read later` viene creata automaticamente.
  - L'onboarding salva gli interessi in `user_interests`.
  - Feed, library, settings e paper detail leggono dati da Supabase.
  - Search legge il catalogo Supabase e riusa le card lista esistenti.
  - Le azioni dismiss, open detail, favorite e save to playlist scrivono interazioni utente.
  - Il feed usa un primo ranking MVP con interessi selezionati, feedback recente e penalita' per paper gia' aperti/letti.
  - Feed, digest e dettaglio permettono di scegliere una o piu' playlist
    private o crearne una inline; lo swipe rapido salva in `Read later`.
  - Il dettaglio paper registra i segnali `already_read` e `not_interested`.
- Ingestion arXiv MVP: completata e ampliata.
  - Script `scripts/ingest-arxiv.ts` con 10 categorie CS di default.
  - Workflow GitHub Actions giornaliero/manuale.
  - Modalita' backfill storico con `--backfill` e `--backfill-pages`.
  - Discovery automatica mensile di paper classici/alto impatto tramite Semantic Scholar, separata dal worker incrementale.
  - Discovery classici organizzata per aree CS descritte, con query seed mirate e filtro opzionale per categoria.
  - 447 paper arXiv nel database, 0 duplicati `arxiv_id`.
- Enrichment esterno: completato.
  - Semantic Scholar: 277 paper con citation count, venue corretta, DOI, S2 ID.
  - OpenAlex: 11 paper con venue publisher, open access status, topic, abstract.
  - Unpaywall: 24 URL open access legali per paper con DOI.
- Embedding batch: completati sul percorso worker/RPC.
  - Modello corrente: `sentence-transformers/all-MiniLM-L6-v2`, scelto dopo benchmark offline (+17.4% Rec@20 vs BGE-small).
  - 571 paper embeddings MiniLM in `papers.embedding`.
  - 66 topic embeddings MiniLM in `topic_embeddings`; le righe BGE-small restano baseline storica nelle tabelle multi-modello.
  - 2 user profile embeddings MiniLM in `user_profile_embeddings`; il retrieval filtra i profili sul modello corrente.
  - RPC `match_papers_by_embedding` per cosine similarity search attiva con default MiniLM.
- Feed semantico: profilo utente generato su write da onboarding/settings, con primo batch feed e batch live breve salvati in `recommendations` per evitare reranking completo a ogni refresh.
  - Retrieval IVFFlat con 10 probe; batch cache sotto 10 risultati visibili vengono rigenerati e deck semantici sotto 50 candidati non visti vengono completati dal catalogo mantenendo e persistendo la provenienza del candidato.
- Gate stabilita' raccomandazioni: App CI mantiene un sanity check sintetico separato da una baseline discriminante con rilevanza graduata, profili sovrapposti, feedback, paper gia' visti e segnali in conflitto; blocca regressioni medie e del profilo peggiore su NDCG/recall, exposure coverage, sovrapposizione e seen-paper leakage. Un workflow separato riporta il p95 del reranker senza renderlo inizialmente bloccante.
- Onboarding interessi: wizard full-screen scuro e guidato, senza navigazione libera tra step, con controlli separati a destra su desktop.
- LLM triage summary: implementato.
  - Worker `scripts/generate-summaries.ts` con Jina AI Reader + Gemini; il
    workflow schedulato usa `gemini-3.5-flash` con output JSON strutturato.
  - Summary JSONB in `papers.triage_summary` con 4 sezioni strutturate.
  - Visualizzati nella pagina paper detail sotto l'abstract.
- Clerk JWT + Supabase RLS: configurato.
  - `createClerkAuthenticatedClient()` per query Supabase con JWT Clerk + anon key.
  - Isolamento verificato con test deterministici A/B/anonimo e smoke Clerk Development A/B.
  - Lo smoke live predefinito e' un gate profilo non mutante, limitato a Clerk
    Development e a utenti dedicati `+clerk_test`, con report mascherato e
    revoca obbligatoria delle sessioni.
  - Nessun test automatizzato autentica utenti o crea sessioni Clerk Production;
    il lifecycle gruppi mutante resta confinato a Development.
- Gruppi di ricerca privati: fondazione #95 e chiusura account #107 applicate
  al progetto Supabase condiviso con kill switch disattivati; lifecycle degli
  inviti e delle membership #96 verificato su PostgreSQL isolato e sul database
  condiviso con fixture sintetiche completamente rimosse.
- KaTeX: rendering LaTeX in abstract e summary su detail page e feed card (scelto dopo aver scartato MathJax per via della dimensione bundle e complessita' CDN).
- Sicurezza: audit service-role completato, checklist rotazione secret documentata.
- Test: suite Playwright smoke con 5 test dev-auth.
- Osservabilita': logger JSON strutturato con `feed_timing`, preload feed, personalizzazione onboarding ed errori API deck.
- Library: `Read later`, Favorites e storico `Ignored` sono raccolte di sistema
  selezionabili, separate visivamente dalle playlist custom; `Read later` e'
  la vista predefinita e viene renderizzata per prima. Le altre raccolte sono
  normalizzate e precaricate privatamente in background; selezione e modifica
  restano locali e aggiornano l'URL senza una navigazione server.

## Prossimi passi

- Monitorare `feed_timing` dopo il preload iniziale e il riuso del batch live; valutare un rinnovo batch/background worker per sessioni lunghe.
- Rivedere strategia storage summary JSONB prima di scalare oltre 10K paper (rivisto in Session 8 — decision document in `docs/summaries.md`).

## Principio sui contenuti

La app deve distinguere chiaramente tre livelli:

1. Metadati bibliografici: titolo, autori, anno, venue, DOI, categorie, citation count.
2. Abstract: testo mostrato in app e usato per ranking/embedding.
3. Full text/PDF: preferibilmente solo linkato nella prima versione, non copiato integralmente.

Per motivi legali e pratici, l'MVP deve evitare di importare e ripubblicare full text di articoli non chiaramente open access. La app puo' comunque mostrare articoli non accessibili se ha metadati e abstract, indicando che il full text potrebbe richiedere accesso esterno.

## Vincolo costi

La prima versione deve rimanere il piu' possibile gratuita:

- usare API gratuite o con free tier;
- evitare scraping fragile o contrario ai termini dei servizi;
- partire da arXiv come sorgente principale;
- usare Semantic Scholar/OpenAlex solo entro i limiti gratuiti disponibili;
- preferire PostgreSQL + pgvector a servizi vector database a pagamento;
- valutare embeddings locali/open-source prima di usare API cloud a consumo.

Se una funzionalita' richiede costi ricorrenti, deve essere marcata come post-MVP o opzionale.

## Product guardrails

PaperDeck is a **daily CS triage deck**, not a generalist research suite. Every decision should make the 3-minute daily triage loop faster or more accurate.

Regole operative:

1. **Scope check:** any proposed MVP feature must pass the question: *"Does this help a CS researcher discover, skim, and shortlist relevant papers in under 3 minutes?"*
2. **Avoid scope creep:** features that turn PaperDeck into a reference manager, PDF reader, AI chat assistant, or universal search engine are post-MVP by default.
3. **Vertical focus:** CS only for MVP. Broadening to other disciplines requires explicit discussion.
4. **Privacy-first:** user reading behavior and personal data stay private. No public profiles, shared playlists, or social surfaces until privacy and moderation choices are clear.
5. **Free-first architecture:** every component must work within free tiers (Vercel, Supabase, GitHub Actions). Paid services require prior approval.
6. **Content respect:** never import or republish full text unless the license and source clearly allow it. Always preserve LaTeX/math notation in abstracts.

Features valutate e rimandate:

| Categoria | Keep/Copy per MVP | Avoid per MVP |
|-----------|-------------------|---------------|
| Feed | personalized feed, card deck, swipe triage | infinite scroll, social trending |
| Bookmarks | bookmark/read-later, private playlists | public/social reading lists, collaborative collections |
| Digest | daily alert/digest in-app | email digest, push notifications |
| Summaries | triage summary (why it matters, contribution, prerequisites) | audio summaries, full translation workflow |
| Access | open-access link preference | PDF viewer, full-text RAG on publisher PDFs |
| Search | topic/category-based filtering | universal author/journal/institution search |
| Reference mgmt | future minimal Zotero export | full reference manager replacement, Mendeley sync |
| AI | ranking and semantic matching (local, free) | PDF chat, AI reading assistant, cloud API costs |

## Naming

Nome consigliato: `PaperDeck`.

Repo description consigliata:

`Mobile-first academic paper discovery for computer science, with swipe-based recommendations, private reading lists, and open-source semantic ranking.`

Motivazione:

- richiama il deck di card full-screen;
- resta abbastanza generale se in futuro si esce dalla sola informatica;
- non lega il prodotto a una singola fonte come arXiv;
- e' piu' neutro e professionale di un nome troppo social/gimmick;
- funziona bene come repository: `paperdeck`.

Alternative se `paperdeck` non fosse disponibile:

- `cs-paperdeck`
- `research-deck`
- `paperfeed`
- `scholar-deck`

`ScienceGram` resta una buona idea di tono, ma come nome pubblico e' piu' vicino a una piattaforma social generica e meno preciso rispetto all'esperienza deck/paper.

## Strategia dati per MVP

Ordine consigliato:

1. Importare paper da arXiv per categorie CS selezionate.
2. Arricchire i paper con Semantic Scholar quando possibile.
3. Salvare DOI, URL, citation count, venue, external IDs e open access status.
4. Aggiungere OpenAlex per arricchimento e deduplica.
5. Aggiungere DBLP per migliore copertura di conferenze e journal CS.
6. Aggiungere Unpaywall per trovare link legali a copie open access.

Categorie arXiv iniziali:

- `cs.AI`: Artificial Intelligence
- `cs.CL`: Computation and Language
- `cs.CR`: Cryptography and Security
- `cs.CC`: Computational Complexity
- `cs.DS`: Data Structures and Algorithms
- `cs.LG`: Machine Learning
- `cs.LO`: Logic in Computer Science
- `cs.PL`: Programming Languages
- `cs.SE`: Software Engineering
- `cs.SY`: Systems and Control

Categorie opzionali:

- `cs.DB`: Databases
- `cs.DC`: Distributed, Parallel, and Cluster Computing
- `cs.IR`: Information Retrieval
- `cs.NE`: Neural and Evolutionary Computing
- `cs.OS`: Operating Systems
- `cs.RO`: Robotics

## Tassonomia interessi

La selezione interessi deve essere gerarchica e progressiva, simile alla scelta artisti di Spotify:

1. L'utente sceglie una macroarea.
2. La app mostra sottoaree piu' specifiche.
3. Quando l'utente seleziona una sottoarea, la app propone topic ancora piu' granulari e topic vicini.
4. Dopo l'onboarding, la modifica esplicita dei topic avviene dalle impostazioni.

Esempio iniziale:

- Informatica teorica
  - Teoria della complessita'
  - Algoritmi
  - Logica in informatica
  - Computabilita'
- Algoritmi
  - Algoritmi paralleli
  - Algoritmi di approssimazione
  - Algoritmi randomizzati
  - Algoritmi online
  - Algoritmi su grafi
  - Strutture dati
- Teoria della complessita'
  - P vs NP
  - Complessita' parametrizzata
  - Complessita' descrittiva
  - Proof complexity
  - Problemi indecidibili
- Linguaggi di programmazione
  - Type systems
  - Semantica dei linguaggi
  - Compilatori
  - Program analysis
  - Formal methods
- AI, ML e LLM
  - Machine learning
  - NLP
  - Large language models
  - Information retrieval
  - AI agents
- Sistemi
  - Sistemi distribuiti
  - Operating systems
  - Databases
  - Security

Questa tassonomia deve essere derivata inizialmente dalle fonti disponibili, in particolare categorie arXiv e topic OpenAlex/Semantic Scholar quando disponibili. Dopo l'import, va curata e normalizzata dentro l'app per evitare duplicati, topic troppo rumorosi o nomi incoerenti.

La tassonomia deve essere salvata come dati applicativi, non hardcodata solo nella UI, cosi' puo' crescere senza cambiare componenti frontend.

## Esperienza utente MVP

### Onboarding

Step iniziali:

1. Login con Google tramite Clerk.
2. Scelta interessi da tassonomia CS gerarchica.
3. Domande rapide per calibrare il profilo:
   - "Preferisci teoria, sistemi, AI applicata o linguaggi?"
   - "Vuoi piu' paper recenti o vuoi includere anche classici?"
   - "Quanto vuoi contenuto tecnico/matematico?"
4. Prima generazione feed.

La selezione interessi deve funzionare cosi':

- prima vengono mostrate macroaree ampie;
- ogni scelta apre un livello piu' specifico;
- la app suggerisce topic simili a quelli gia' selezionati;
- alla fine l'utente conferma un profilo iniziale;
- dopo l'onboarding, i topic si modificano dalle impostazioni.

### Feed swipe-style

Ogni card paper deve includere:

- Titolo.
- Autori principali.
- Anno e fonte.
- Categorie/topic.
- Abstract preview ellipsata.
- Espansione abstract stile descrizione post social.
- Motivo sintetico della raccomandazione.
- Link "Read".
- Azioni: non interessante, apri dettaglio, preferito, salva in playlist.

Interazioni:

- Swipe right: salva in Read later.
- Swipe left: non interessante per questo paper specifico.
- Tap: dettaglio paper.
- Cuore: aggiunge/rimuove dai preferiti.
- Segnalibro: apre il picker delle playlist private; lo swipe rapido salva
  direttamente nella playlist default `Read later`.
- Modifica topic: solo dalle impostazioni, non tramite swipe.

La card full-screen puo' scrollare verticalmente quando l'abstract viene espanso. Di default deve mostrare solo una preview per mantenere il ritmo social-like del feed.

Preview consigliata:

- mobile: circa 10 righe prima del "more";
- desktop: preview piu' ampia, ad esempio 12-16 righe;
- dopo espansione: card scrollabile verticalmente.

Alternative UX da valutare:

- Feed stile social con scroll verticale.
- Modalita' "deck" una card alla volta.
- Modalita' dashboard per ricerche e collezioni.

Decisione provvisoria: partire con deck mobile-first, stile social e card singola full-screen, mantenendo anche una lista cronologica per preferiti e playlist.

### Paper detail

Pagina dettaglio:

- Titolo completo.
- Abstract completo.
- Autori.
- Fonte originale.
- DOI/arXiv ID/Semantic Scholar ID/OpenAlex ID.
- Link esterni:
  - pagina arXiv, se esiste;
  - PDF, se disponibile legalmente;
  - DOI/publisher page;
  - Semantic Scholar/OpenAlex, se utile.
- Azioni:
  - preferito;
  - aggiungi a playlist;
  - segna come gia' letto;
  - non raccomandare paper simili.

Stato attuale:

- Preferito e appartenenza alle playlist private sono persistenti; `Read later`
  resta la destinazione rapida dello swipe.
- `Already read` registra `already_read` e rimuove il paper dal deck attivo.
- `Not interested` registra `not_interested`, rimuove il paper dal deck attivo e influenza negativamente i topic correlati nel ranking MVP.

### Preferiti e playlist

MVP:

- Preferiti personali.
- Playlist private.
- Aggiunta/rimozione paper.
- Ordinamento manuale o per data di salvataggio.
- Playlist default `Read later` creata automaticamente.

Stato attuale:

- Preferiti persistiti in `favorites`.
- Playlist default `Read later` persistita in `playlists`.
- Salvataggio paper in `playlist_items`.
- Library collegata ai dati persistenti.
- Preferiti, salvataggi e aperture dettaglio sono segnali usati dal ranking MVP.
- Rimozione paper da `Read later`: implementata.
- Creazione playlist custom, selezione multipla, creazione inline e ordinamento
  manuale: implementati.
- Library a raccolta singola: `Read later`, Favorites, Ignored e playlist custom
  condividono la stessa area contenuti; una linea separa le raccolte di sistema
  dalle playlist custom. La matita attiva/disattiva localmente la gestione di
  `Read later`, Favorites e playlist custom; Ignored resta in sola lettura.

Futuro:

- Playlist condivisibili.
- Export BibTeX/RIS.
- Note personali.
- Tag personali.

Per "note personali" si intende un campo privato per annotazioni libere su un paper, ad esempio:

- perche' e' utile;
- quale risultato contiene;
- relazione con un proprio progetto;
- dubbi o cose da approfondire;
- mini-riassunto personale.

Non e' indispensabile nell'MVP se l'obiettivo principale e' discovery + ranking.

Decisione: note personali post-MVP.

Stato: implementato. La pagina di dettaglio paper include note private: si scrivono in un box che si svuota dopo il salvataggio e vengono mostrate come log cronologico con data e ora (`paper_notes`, più note per paper, opzionalmente collegate a una playlist), visibili solo all'utente.

### Digest

MVP semplice:

- Digest giornaliero o settimanale solo in app.
- Lista "New for you".

Futuro:

- Email digest.
- Push notification PWA se supportato.
- Preferenze: frequenza, topic inclusi, soglia minima di rilevanza.

## Ranking e personalizzazione

### Segnali utente

Segnali espliciti:

- Interessi scelti in onboarding.
- Swipe right/left.
- Preferiti.
- Paper salvati in playlist.
- Paper segnati come gia' letti.

Segnali impliciti:

- Apertura dettaglio.
- Click su "Read".
- Tempo di permanenza sulla card/dettaglio.
- Espansione abstract.

Per MVP e' meglio partire con segnali espliciti. I segnali impliciti possono essere aggiunti dopo, con attenzione alla privacy.

Decisione: l'apertura dettaglio tramite il pulsante Open conta come segnale positivo leggero, inferiore a preferito e salvataggio in playlist.

Stato attuale:

- `src/lib/ranking/feed-ranking.ts` calcola il ranking lato server come modulo puro riusabile.
- I topic selezionati hanno peso principale.
- I feedback positivi su paper gia' aperti, preferiti o salvati aumentano il peso dei topic correlati.
- `dismiss`, `not_interested`, `read`, `already_read` e `open_detail` rimuovono il paper dal deck attivo, cosi' il feed avanza dopo l'apertura dettaglio.
- Embeddings e pgvector non sono ancora usati nel ranking live.

### Ranking MVP

Score paper consigliato:

```text
score =
  semantic_similarity(user_profile_embedding, paper_embedding)
  + topic_match_score
  + open_detail_small_boost
  + positive_feedback_boost
  - already_seen_penalty
  - negative_feedback_penalty
  + freshness_small_boost
  + citation_small_boost
```

La similarita' semantica deve pesare piu' di citazioni e freschezza.

Motivazione:

- L'utente vuole massima aderenza agli interessi.
- Paper famosi o gia' letti non devono dominare il feed.
- Paper recenti sono utili, ma non devono sostituire la rilevanza.
- Aprire il dettaglio indica curiosita', ma pesa meno di cuore o salvataggio.

### Cold start

Per nuovi utenti:

- Tassonomia interessi.
- 5-10 paper seed per area.
- Domande rapide di preferenza.
- Feed misto: 65% aderente, 20% esplorativo, 15% classici/alto impatto.
- I classici sono ammessi, ma non devono saturare il feed.
- Nel feed giornaliero, i paper classici dovrebbero restare intorno al 10-15% salvo preferenze future dell'utente.

### Embeddings MVP

Decisione corrente: usare un modello embedding open-source locale, senza API cloud a consumo.

Modello corrente:

- `sentence-transformers/all-MiniLM-L6-v2`

Motivi:

- e' leggero rispetto a modelli base/large;
- produce embedding a 384 dimensioni, quindi costa meno in storage e query pgvector;
- e' adatto a retrieval semantico in inglese;
- gira realisticamente su CPU per batch piccoli;
- si integra facilmente con `sentence-transformers`;
- nel benchmark offline del 2026-07-02 ha migliorato Rec@20 del 17.4% rispetto a BGE-small ed e' risultato piu' veloce.

Baseline storiche confrontate:

- `BAAI/bge-small-en-v1.5`, default iniziale e baseline del primo smoke test;
- `intfloat/e5-small-v2`, perche' e' una famiglia che hai gia' provato in contesto Information Retrieval;
- `sentence-transformers/all-MiniLM-L6-v2`, ora modello corrente.

Strategia:

1. Usare `sentence-transformers/all-MiniLM-L6-v2` come default nei worker, nella RPC e nei profili utente.
2. Salvare `embeddingModel`, `embeddingDimension` e `embeddedAt` per ogni paper.
3. Eseguire il modello fuori da Vercel, inizialmente su GitHub Actions o localmente.
4. Salvare gli embedding in Supabase/pgvector e usare Vercel solo per retrieval leggero e reranking.
5. Considerare stale le righe con `embedding_model` diverso dal default corrente.
6. Mantenere benchmark offline ripetibili con interessi reali e 50-100 paper valutati manualmente.
7. Valutare un modello diverso solo dopo aver misurato qualita', tempo batch e costi.

Specifica operativa: `docs/embeddings.md`.

Nota: per E5 bisogna usare prefix coerenti tipo `query:` per il profilo utente e `passage:` per i paper. Questo va gestito a livello di embedding service.

### Evitare paper gia' noti

Funzioni utili:

- "Gia' letto".
- "Conosco gia' questo paper".
- Import futuro da BibTeX/Google Scholar/ORCID/DBLP author page.
- Penalita' per paper molto famosi se l'utente li scarta spesso.

## Architettura

La scelta architetturale e' free-first: Vercel per la webapp e le API leggere, Supabase Postgres + pgvector per database e vector search, worker batch su GitHub Actions per ingestion ed embeddings (fuori dalle Vercel Functions, che hanno limiti di durata e memoria). Dettagli: [`docs/architecture.md`](./docs/architecture.md).

## Funzioni post-MVP

- Riassunto in italiano.
- Traduzione abstract.
- Chat/RAG su abstract.
- Chat/RAG su full text open access.
- Import libreria utente da BibTeX.
- Export BibTeX/RIS.
- Note personali.
- Tag personali.
- Playlist condivisibili.
- Follow di autori, venue o keyword.
- Raccomandazioni "paper simili".
- Cluster per topic.
- Modalita' "leggi dopo".
- Supporto iPad/desktop piu' ricco.

## Migrazione RLS completata (ex domanda aperta)

La configurazione Clerk JWT + Supabase RLS e' stata completata (vedi `docs/clerk-supabase-rls.md`). Resta da completare il passaggio 3: migrare le repository function user-scoped dal service role al clerk-authenticated client. Tracciato in issue #47.

## Domande aperte

1. Verificare in produzione il backfill MiniLM e monitorare `feed_timing` per eventuali fallback dovuti a profili o paper non ancora re-embedded.
