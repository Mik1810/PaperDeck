# PaperDeck ROADMAP

Ultimo aggiornamento: 2026-07-03

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
- Swipe right apre la scheda dettaglio del paper.
- Preferiti e swipe sono segnali diversi: cuore per preferiti, segnalibro per playlist.
- Abstract nella card: preview ellipsata, espandibile stile descrizione post social, con scroll verticale nella card.
- Search MVP: tab autenticata per cercare nel catalogo CS locale per titolo, autore, topic e identificativi, senza diventare una ricerca universale tipo reference manager.
- Aprire il dettaglio e' un segnale positivo leggero per il ranking.
- Segnalibro: salva prima in una playlist default tipo `Read later`.
- Preview abstract: circa 10 righe su mobile, adattiva su desktop.
- Embeddings MVP: modello open-source locale, con `sentence-transformers/all-MiniLM-L6-v2` come default corrente dopo benchmark offline; BGE-small resta baseline storica.
- Worker batch online MVP: GitHub Actions giornaliero e avviabile manualmente.
- Database online MVP: Supabase Postgres + pgvector.
- Supabase region: preferire `eu-central-2` Zurich se disponibile, fallback `eu-central-1` Frankfurt.
- Paper classici: massimo indicativo 10-15% del feed.
- Digest: solo in-app nella prima versione.
- Note personali: post-MVP.
- Collaborazione post-MVP: piccoli gruppi di ricerca privati, ciascuno con una sola lista condivisa di paper; solo owner/admin invitano membri e ogni invito richiede accettazione.
- Discovery collaborativa: ricerca account tramite email esatta attiva di default ma disattivabile; amicizie reciproche con cooldown di 30 giorni dopo un rifiuto e nessun social graph pubblico.
- Ownership gruppi: successore scelto dall'owner, altrimenti admin attivo piu' anziano, poi membro attivo piu' anziano; gruppo eliminato solo se non esistono altri membri.
- Notifiche collaborative: inbox durevole in-app con badge `99+`, menu degli ultimi 20 eventi, azioni inline e futura cronologia completa; eventi realtime accelerano la UI ma non sostituiscono Postgres.
- Discussione nei gruppi: possibile chat interattiva collegata ai paper, da progettare separatamente prima di qualsiasi implementazione.
- Tassonomia interessi: derivata dalle fonti disponibili, poi curata e normalizzata dentro l'app.
- Vincolo economico: approccio free-first, evitando servizi a pagamento finche' possibile.
- Caching layer: resta basato su Postgres (tabella `recommendations`, TTL 5 minuti). Redis/KV esterni sono rinviati fino al superamento di threshold definiti (catalogo >100k, GET /feed p95 >2s, QPS sostenuto oltre limiti free tier). Il preferred path post-threshold e' Next.js cache built-in prima di valutare servizi esterni.

## Stato implementazione

Aggiornato al 2026-07-03:

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
  - `Read later` supporta aggiunta e rimozione da feed, dettaglio e library.
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
- Gate stabilita' raccomandazioni: App CI blocca regressioni deterministiche di NDCG/recall, copertura e sovrapposizione; un workflow separato riporta il p95 del reranker senza renderlo inizialmente bloccante.
- Onboarding interessi: wizard full-screen scuro e guidato, senza navigazione libera tra step, con controlli separati a destra su desktop.
- LLM triage summary: implementato.
  - Worker `scripts/generate-summaries.ts` con Jina AI Reader + GitHub Models.
  - Summary JSONB in `papers.triage_summary` con 4 sezioni strutturate.
  - Visualizzati nella pagina paper detail sotto l'abstract.
- Clerk JWT + Supabase RLS: configurato.
  - `createClerkAuthenticatedClient()` per query Supabase con JWT Clerk + anon key.
  - RLS policy attive, verificate con smoke test.
- KaTeX: rendering LaTeX in abstract e summary su detail page e feed card (scelto dopo aver scartato MathJax per via della dimensione bundle e complessita' CDN).
- Sicurezza: audit service-role completato, checklist rotazione secret documentata.
- Test: suite Playwright smoke con 5 test dev-auth.
- Osservabilita': logger JSON strutturato con `feed_timing`, preload feed, personalizzazione onboarding ed errori API deck.
- Library: storico `Ignored` per paper dismissati o marcati not interested.

## Prossimi passi

- Monitorare `feed_timing` dopo il preload iniziale e il riuso del batch live; valutare un rinnovo batch/background worker per sessioni lunghe.
- Feature P2: playlist custom, digest in-app, metadati paper detail migliorati.
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

## Fonti dati candidate

### arXiv

Uso consigliato per MVP.

Pro:

- Ottima copertura per informatica, AI, ML, teoria, sistemi e linguaggi.
- Fornisce abstract, categorie e link alla pagina/PDF.
- Molti paper sono gia' in formato preprint accessibile.

Contro:

- Non copre bene tutti i paper pubblicati in conferenze/journal se non hanno preprint.
- Rate limit conservativo: le API legacy richiedono massimo una richiesta ogni 3 secondi.

Riferimenti:

- https://info.arxiv.org/help/api/user-manual.html
- https://info.arxiv.org/help/api/tou.html

### Semantic Scholar

Uso consigliato come seconda sorgente.

Pro:

- Buona copertura di paper, autori, abstract, citazioni e URL.
- Utile per arricchire dati e migliorare raccomandazioni.
- Include endpoint utili per paper search e recommendation.

Contro:

- Serve API key per uso serio.
- Rate limit iniziale con API key: 1 request/sec.

Riferimento:

- https://www.semanticscholar.org/product/api

### OpenAlex

Uso consigliato per arricchimento e copertura ampia.

Pro:

- Catalogo molto ampio del sistema della ricerca.
- Buono per DOI, autori, istituzioni, venue, citazioni, open access status e topic.
- Puo' dare link open access quando disponibili.

Contro:

- Gli abstract non sono sempre plaintext; possono essere rappresentati come `abstract_inverted_index`.
- Dal 2026 l'API richiede una API key gratuita e ha pricing/crediti per uso oltre soglia.

Riferimenti:

- https://developers.openalex.org/
- https://help.openalex.org/hc/en-us/articles/24347035046295-Open-Access-OA

### DBLP

Uso consigliato per copertura bibliografica CS.

Pro:

- Fonte molto autorevole per informatica.
- Ottima per venue, autori, conferenze e pubblicazioni CS.

Contro:

- Non e' pensata come sorgente principale di abstract.
- Serve combinarla con DOI, OpenAlex, Crossref o Semantic Scholar.

Riferimenti:

- https://dblp.org/
- https://dblp.org/faq/How%2Bto%2Buse%2Bthe%2Bdblp%2Bsearch%2BAPI

### Crossref

Uso consigliato per lookup DOI e metadati.

Pro:

- Molto utile quando abbiamo DOI o citazioni.
- Fornisce metadati bibliografici depositati dai publisher.

Contro:

- Non basta da sola per raccomandazioni.
- Abstract non sempre disponibili o riutilizzabili allo stesso modo.

Riferimento:

- https://www.crossref.org/documentation/retrieve-metadata/rest-api/

### Unpaywall

Uso consigliato per capire se esiste una copia open access legale.

Pro:

- Dato un DOI, restituisce stato open access e possibili URL full text.
- Utile per mostrare "Read online", "PDF available", "Publisher page".

Contro:

- Copre DOI Crossref, non ogni possibile identificatore.
- Non e' una sorgente generale di raccomandazioni.

Riferimento:

- https://unpaywall.org/products/api

### CORE

Uso futuro, non indispensabile nell'MVP.

Pro:

- Accesso a metadati e full text/PDF da repository open access.
- Utile per funzionalita' RAG sul full text open access.

Contro:

- Introduce complessita' maggiore su parsing, deduplica e licenze.

Riferimento:

- https://core.ac.uk/documentation/api

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

## Gestione LaTeX e formule

Nell'MVP la app deve mostrare l'abstract cosi' come arriva dalla sorgente, preservando simboli, formule inline e notazione scientifica.

Per una buona resa su mobile:

- Usare rendering Markdown/HTML controllato solo se la fonte e' affidabile.
- Rendere formule LaTeX con KaTeX quando compaiono pattern tipo `$...$`, `\\(...\\)` o `\\[...\\]`.
- Non tentare di ricostruire il layout PDF dell'articolo nella prima versione.
- Linkare sempre la pagina originale o il PDF originale quando disponibile.

Per una fase RAG/full text futura:

- Estrarre testo solo da fonti open access o con licenza chiara.
- Conservare sezioni, formule, riferimenti e figure come strutture separate.
- Usare parser scientifici come GROBID o conversioni da sorgente TeX quando disponibili.
- Nel viewer interno, riprodurre formule e sezioni in modo leggibile, senza pretendere pixel-perfect rispetto al PDF.

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

- Swipe right: apre la scheda dettaglio del paper.
- Swipe left: non interessante per questo paper specifico.
- Tap: dettaglio paper.
- Cuore: aggiunge/rimuove dai preferiti.
- Segnalibro: salva nella playlist default `Read later`.
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

- Preferito e `Read later` sono toggle persistenti.
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
- Creazione playlist custom e ordinamento manuale: da implementare.

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

Decisione: l'apertura dettaglio tramite swipe right conta come segnale positivo leggero, inferiore a preferito e salvataggio in playlist.

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

## Architettura proposta

### Stack applicativo

- Framework: Next.js con TypeScript.
- UI: React mobile-first.
- Auth: Clerk con Google OAuth.
- Database: Supabase Postgres.
- ORM: Drizzle (scelto su Prisma per peso minore e migliore compatibilita' pgvector).
- Vector search: pgvector.
- Jobs: worker schedulato separato.
- Deploy: Vercel per frontend/backend iniziale, Supabase per database gestito.

Supabase:

- progetto: `PaperDeck`;
- region preferita: `eu-central-2` Zurich, se disponibile nel form di creazione;
- fallback: `eu-central-1` Frankfurt;
- ulteriore fallback europeo: `eu-west-3` Paris;
- evitare `eu-west-1` Ireland se sono disponibili Zurich o Frankfurt, perche' sono piu' vicine a Roma.
- schema iniziale: `supabase/schema.sql`;
- schema applicato al progetto Supabase il 2026-07-01;
- documentazione modello dati: `docs/database.md`;
- ownership MVP: record user-owned con `owner_id text` valorizzato con Clerk user ID;
- accesso MVP: query user-specific tramite server routes/actions, senza esporre `SUPABASE_SERVICE_ROLE_KEY` al browser;
- RLS: policy preparate per futura integrazione Clerk JWT, dove `auth.jwt() ->> 'sub'` deve corrispondere al Clerk user ID.

Nota costi:

- Per restare nel gratis, il primo prototipo puo' usare Supabase Postgres + pgvector.
- In deploy pubblico, scegliere free tier solo finche' i limiti bastano.
- Gli embeddings possono partire con modello locale/open-source eseguito dal worker.
- Eventuali API cloud a consumo devono restare sostituibili.

### Deploy free-first

Vercel e' adatto per:

- frontend Next.js;
- autenticazione Clerk;
- API leggere;
- pagine feed, dettaglio, preferiti e playlist;
- query di ranking gia' calcolate o basate su pgvector.

Vercel non deve essere il componente principale per:

- ingestion massiva da API accademiche;
- parsing PDF o full text;
- generazione embeddings con modelli locali;
- job lunghi o batch pesanti.

Motivo: le Vercel Functions hanno limiti di durata, memoria, payload e dimensione bundle. Anche se Vercel supporta Cron Jobs, questi invocano funzioni HTTP e non sono il posto ideale per processi lunghi.

Architettura free-first proposta:

1. Vercel per webapp e API leggere.
2. Supabase Postgres + pgvector sul free tier.
3. Worker batch separato per ingestion e embeddings.
4. Nel primissimo prototipo, worker eseguito localmente dal computer dello sviluppatore e push dei risultati nel database remoto.
5. Per il primo deploy online, worker su GitHub Actions con `workflow_dispatch` manuale e schedule giornaliera.
6. Se il repo resta privato o i limiti GitHub Actions diventano stretti, mantenere fallback locale/manuale o valutare self-hosted runner.

In questo modo l'app puo' stare online mentre embeddings e ingestion restano sostituibili, senza bloccare il deploy su Vercel.

### Worker batch MVP

Scelta consigliata: GitHub Actions.

Motivi:

- non gira su Vercel;
- puo' essere schedulato;
- puo' essere avviato manualmente;
- puo' leggere segreti come `DATABASE_URL`, API key e configurazioni;
- per repository pubblici con runner standard e' gratuito.

Limiti:

- non va usato come sistema near-real-time;
- i batch devono essere piccoli e idempotenti;
- deve salvare checkpoint per riprendere senza duplicare dati;
- deve rispettare rate limit arXiv/Semantic Scholar/OpenAlex;
- se il volume cresce, andra' sostituito con un worker dedicato.

Pipeline iniziale:

1. Fetch nuovi paper per categorie CS.
2. Deduplica.
3. Normalizzazione metadati e abstract.
4. Embedding con modello locale open-source.
5. Upsert in Postgres/pgvector.
6. Aggiornamento topic/tassonomia.

Stato attuale:

- Workflow `.github/workflows/ingest-arxiv.yml` creato.
- Script `npm run ingest:arxiv` creato.
- Esecuzione locale supporta `--dry-run`, `--categories` e `--max-results`.
- Richiede `NEXT_PUBLIC_SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`.
- Verifica locale completata con import reale di 2 paper `cs.CC` nel Supabase remoto.
- Cursore `arxiv:cs.CC` verificato: una seconda run sulla stessa slice importa 0 paper e aggiorna il cursore con `imported_count = 0`.

### Componenti principali

1. Web app
   - Onboarding.
   - Feed swipe.
   - Paper detail.
   - Preferiti.
   - Playlist.
   - Impostazioni digest.

2. API backend
   - Profilo utente.
   - Feed recommendation.
   - Azioni swipe/preferiti/playlist.
   - Paper search.

3. Ingestion worker
   - Fetch da arXiv/Semantic Scholar/OpenAlex.
   - Deduplica per DOI, arXiv ID, Semantic Scholar ID, titolo normalizzato.
   - Normalizzazione abstract e metadati.
   - Calcolo embeddings.

4. Ranking service
   - Costruzione profilo utente.
   - Retrieval candidati.
   - Re-ranking.
   - Logging raccomandazioni viste.

5. Notification/digest service
   - Generazione digest.
   - Invio email/push solo post-MVP.

## Modello dati iniziale

Entita' principali:

- `User`
- `Profile`
- `UserInterest`
- `Paper`
- `PaperExternalId`
- `PaperAuthor`
- `PaperTopic`
- `UserPaperInteraction`
- `Favorite`
- `Playlist`
- `PlaylistItem`
- `Recommendation`
- `Digest`
- `TaxonomyTopic`
- `TopicRelation`
- `EmbeddingJob`
- `IngestionRun`
- `DigestItem`

Campi minimi `Paper`:

- `id`
- `title`
- `abstract`
- `year`
- `publishedAt`
- `updatedAt`
- `source`
- `doi`
- `arxivId`
- `semanticScholarId`
- `openAlexId`
- `url`
- `pdfUrl`
- `venue`
- `citationCount`
- `isOpenAccess`
- `topics`
- `embedding`
- `embeddingModel`
- `embeddingDimension`
- `embeddedAt`

Campi minimi `UserPaperInteraction`:

- `ownerId`
- `paperId`
- `action`: `open_detail`, `dismiss`, `favorite`, `save_to_playlist`, `read`, `seen`, `not_interested`, `already_read`
- `createdAt`
- `context`: feed, search, playlist, digest

## Fasi di sviluppo

### Fase 0: definizione prodotto

Output:

- ROADMAP.md.
- Scelta stack definitiva.
- Definizione MVP esatto.
- Lista fonti dati iniziali.
- Prime wireframe testuali.

Stato: in corso.

### Fase 1: scaffold tecnico

Output:

- Progetto Next.js TypeScript.
- Configurazione Clerk.
- Database Supabase Postgres + pgvector.
- Schema SQL iniziale in `supabase/schema.sql`.
- Layout mobile-first.
- PWA basics.

### Fase 2: onboarding e profilo interessi

Output:

- Login Google.
- Creazione account/profilo.
- Schermata interessi CS.
- Salvataggio preferenze.
- Prima rappresentazione vettoriale del profilo utente.

Stato implementato:

- Dopo il login, `/` manda a `/feed` gli utenti con onboarding completato o interessi già salvati; i nuovi utenti senza interessi vengono mandati a `/onboarding`.
- Feed, library, settings e dettaglio paper richiedono onboarding completato o interessi salvati; se manca uno stato utilizzabile, la app reindirizza a `/onboarding`.
- L'onboarding e le impostazioni dividono gli interessi in macroaree, categorie e microcategorie; `Not now` completa l'onboarding selezionando tutti gli interessi broad non-micro.
- Il salvataggio finale dell'onboarding persiste subito gli interessi e poi tratta embedding profilo e preload raccomandazioni come personalizzazione best-effort, non come prerequisito del redirect a `/feed`.
- Le impostazioni impediscono di rimuovere tutti gli interessi attivi: almeno una macroarea e un topic devono restare selezionati.
- Le categorie arXiv `cs.*` vengono mostrate con etichette leggibili, mantenendo il codice solo nei dati.

### Fase 3: ingestion paper

Output:

- Import arXiv per categorie CS selezionate.
- Normalizzazione paper.
- Deduplica base.
- Pagina admin/dev per vedere paper importati.
- Rate limiting conforme alle API usate.

### Fase 4: feed e swipe

Output:

- Feed deck mobile.
- Card paper.
- Swipe right/left.
- Azioni preferito e salva.
- Log interazioni.
- Penalizzazione paper gia' visti.

### Fase 5: ranking iniziale

Output:

- Embeddings abstract/titolo.
- Similarita' profilo-paper.
- Score personalizzato.
- Feed ordinato per rilevanza.
- Motivo semplice della raccomandazione.

### Fase 6: preferiti e playlist

Output:

- Lista preferiti.
- Creazione playlist private.
- Aggiunta/rimozione paper.
- Vista playlist.

Stato attuale: lista preferiti, playlist default `Read later`, aggiunta/rimozione da `Read later` e vista library implementate; creazione playlist custom e ordinamento manuale da fare.

### Fase 7: link esterni e accessibilita' articolo

Output:

- Link arXiv/PDF/DOI/publisher.
- Open access status se disponibile.
- Integrazione Unpaywall/OpenAlex per URL legali.
- Apertura affidabile da mobile.

### Fase 8: digest

Output:

- Digest in-app settimanale. ✅ MVP: pagina `/digest` "New for you", lista scannerizzabile raggruppata per topic, paper recenti (ultimi 7 giorni, finestra allargata a 14/30 se pochi), top 10, distinta dal feed a swipe.
- Preferenze digest.
- Email solo post-MVP.

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

## Rischi e decisioni da chiarire

### Copertura paper

Non esiste una singola API gratuita e perfetta che copra "tutti gli articoli possibili" con abstract, metadati, link e full text. La copertura migliore si ottiene combinando piu' fonti e deduplicando.

Decisione proposta:

- MVP: arXiv + Semantic Scholar.
- Subito dopo: OpenAlex + Unpaywall.
- Dopo stabilizzazione: DBLP + Crossref.

### Full text e copyright

Mostrare metadati e abstract e' diverso da importare full text. Per il full text bisogna rispettare licenze, termini API e accessibilita' legale.

Decisione proposta:

- MVP: link esterni, niente full text interno.
- RAG futuro: solo su contenuti open access o esplicitamente consentiti.

### UX principale

La direzione scelta e' social-like: l'esperienza primaria deve essere rapida, visuale e centrata sul feed.

Decisione proposta:

- MVP: deck swipe-style con card singola full-screen.
- Swipe right apre il dettaglio, non equivale a preferito.
- Cuore e segnalibro sono azioni esplicite separate.
- Aggiungere lista/filtro per gestione e recupero paper.

### Ranking dei classici

Molti paper famosi sono utili, ma se l'utente li conosce gia' diventano rumore.

Decisione proposta:

- Aggiungere azione "gia' letto".
- Penalizzare paper visti/scartati.
- Non usare citation count come segnale dominante.

## Migrazione RLS completata (ex domanda aperta)

La configurazione Clerk JWT + Supabase RLS e' stata completata (vedi `docs/clerk-supabase-rls.md`). Resta da completare il passaggio 3: migrare le repository function user-scoped dal service role al clerk-authenticated client. Tracciato in issue #47.

## Fondazione identita' collaborativa

La prima parte del piano social usa un profilo collaborativo minimale: nome pubblico scelto durante l'onboarding, avatar Clerk, UUID pubblico e ricerca soltanto per email esatta. L'indirizzo non viene salvato; il lookup usa un HMAC server-side sincronizzato da webhook Clerk. La discovery e' opt-out, la policy inviti predefinita e' `friends_only`, e profili inesistenti o non trovabili producono lo stesso risultato.

Le amicizie sono reciproche soltanto dopo accettazione. Il lifecycle supporta invio, richiesta incrociata con accettazione automatica, rifiuto con cooldown di 30 giorni, cancellazione, unfriend, block e unblock. Il blocco rimuove le relazioni attive e nasconde la discovery in entrambe le direzioni; amicizie e richieste non scrivono segnali di ranking.

## Domande aperte

1. Verificare in produzione il backfill MiniLM e monitorare `feed_timing` per eventuali fallback dovuti a profili o paper non ancora re-embedded.
