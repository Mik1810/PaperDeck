# Mobile deck swipe: analisi del problema

Data: 2026-08-04

## Sintomo riportato

Su viewport mobile, quando si prova a fare lo swipe sulla card del feed, la
card non segue il dito: la posizione viene "subito resettata al centro". Il
video (`video_codex.mp4`) mostra il problema ma non è consultabile da questo
tool, quindi l'analisi qui sotto si basa su riproduzione in browser
(Chromium mobile, viewport 393x851) con il vero `FeedDeck` e dati sintetici.

## Cosa ho verificato in riproduzione

Con touch events simulati via CDP su una pagina che monta il vero `FeedDeck`:

1. La card non si muove mai con il dito: il `transform` della card resta
   `none` durante l'intero gesto. Non si arriva mai al commit (né
   `dismiss` né `read_later`).
2. La sequenza eventi è: `pointerdown` → `pointermove` (x2) →
   `pointercancel` → ... Il `pointercancel` arriva subito dopo i primi
   `pointermove`, cioè il browser "ruba" il gesto e framer-motion non ha
   modo di farlo partire.
3. Impostando `touch-action: pan-y` **anche sullo scroll container interno**
   (il `div` con `overflow-y-auto` che contiene l'abstract), il
   `pointercancel` sparisce ma il drag comunque non aggancia (test non
   conclusivo a causa di un harness con dev-server degradato).
4. Con il mouse su desktop il drag funziona (il problema è touch-specific).

## Causa root (analisi)

Il card draggable ha `style={{ touchAction: "pan-y", x: dragX }}`, ma questo
`touch-action` non è efficace per un semplice motivo: secondo la spec
[CSS Touch Events](https://www.w3.org/TR/pointerevents/), il `touch-action`
"effettivo" di un touch point è calcolato lungo la catena di antenati **fino
al più vicino scroll container incluso**, non oltre.

Struttura DOM della card attiva:

```
motion.div  (data-testid="active-deck-card")
  touch-action: pan-y   ← impostato, ma IRRILEVANTE
  └─ article (PaperCard)
     └─ div.flex-1.overflow-y-auto   ← NEAREST SCROLL CONTAINER
          touch-action: auto   ← viene applicato QUESTO
          └─ testo/abstract (il punto in cui parte il touch)
```

Il touch parte quasi sempre sul testo dell'abstract, che sta dentro il
`div.overflow-y-auto`. Quel div è il primo scroll container nella catena e ha
`touch-action: auto` (valore di default). Il browser quindi considera il gesto
"pannabile" e, al primo movimento, emette `pointercancel` prendendo il gesto
per sé (scroll verticale / pull-to-refresh). Il `touch-action: pan-y` sulla
card non viene considerato perché sta DOPO (sopra) lo scroll container nella
catena di antenati.

Il fix di Codex (commit `051e591`) ha introdotto proprio
`touch-action: pan-y` sulla card, ma è inefficace proprio per questo motivo:
lo scroll container interno (`overflow-y-auto` dell'abstract, e in parte anche
il `[overflow-y:clip]` del wrapper) ha ancora `touch-action: auto`.

## Fix proposto

Far sì che l'intera catena tra il punto di touch e la card draggable dichiari
che l'asse orizzontale è gestito dal JS e solo quello verticale è scrollabile
nativamente:

- Impostare `touch-action: pan-y` sullo scroll container interno dell'abstract
  (in `paper-card.tsx`, il `div` `flex-1 overflow-y-auto`).
- Verificare/selettivamente impostare `touch-action` coerente sugli altri
  contenitori che possono finire nel path del touch dentro la card
  (es. `article`, eventuali `[overflow-y:clip]`).

In alternativa (più robusta ma più invasiva): rendere la card non scrollabile
internamente e delegare lo scroll verticale a un livello superiore, oppure
usare `dragDirectionLock` + `touch-action: pan-y` su tutti i livelli
intermedi. Il fix minimo consigliato è quello sul `div.overflow-y-auto` interno.

Nota: mantenere `touch-action: pan-y` (e non `none`) è corretto perché
conserva lo scroll verticale nativo dell'abstract, che è voluto.

## Verifica da fare dopo il fix

- Swipe orizzontale a sinistra → dismiss.
- Swipe orizzontale a destra → save to Read later.
- Swipe corta o prevalentemente verticale → snap-back senza mutation.
- Scroll verticale dell'abstract ancora funzionante.
- Desktop (mouse) invariato.
- `npm run typecheck`, `npm run lint`, `npm run test:unit`.
