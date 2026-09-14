## ADDED Requirements

### Requirement: REF-10 — Un job che dichiara riferimenti deve averli, o fallisce

Il sistema SHALL permettere a chi accoda un job di **dichiarare** quali riferimenti la
generazione richiede, e SHALL far fallire il job prima di produrre qualsiasi immagine quando
anche uno solo dei file dichiarati non è allegabile. Il messaggio di errore SHALL nominare
**quale** file manca.

La dichiarazione SHALL essere un dato verificabile, non la stringa descrittiva `config.refset`
già esistente: quella è testo per un umano (`"3 sorgenti insieme + stile"`, costruito a
runtime in `scripts/gen_variants.ts`), e fondare un vincolo su una frase da mostrare è come
fondare la logica sul testo di un bottone.

Il sistema NON SHALL applicare il vincolo ai job che non dichiarano niente: assenza di
dichiarazione significa "non ho promesso nulla", non "ho promesso zero riferimenti". Dei 685
job del progetto Japan, **658** hanno `ref_paths` valorizzato e nessuno ha una dichiarazione:
devono continuare a comportarsi esattamente come oggi.

Il difetto che questo requirement chiude, misurato sul progetto `profilo` il 26/08/2026. Tre
punti di codice, ognuno ragionevole da solo, che insieme producono una generazione muta:

| Dove | Cosa fa |
|---|---|
| `scripts/gen_variants.ts:189` | passa l'elenco reference a `enqueueJob`; se è vuoto, il refset dice comunque "+ stile" |
| `server/jobs.ts:66` | `parseRefPaths` filtra i percorsi con `existsSync`: un file sparito diventa "nessun file", senza dirlo |
| `server/worker-codex-http.ts:93` | `if (existsSync(r))` prima di allegare: stesso silenzio, un secondo giro dopo |

Effetto reale: su 29 job, **1 solo** ha avuto `ref_paths` valorizzato — il job 164 delle
16:49 del 25/08, che dichiarava `style-bw-wet-hair-hardlight.png` ed è morto su HTTP 429
senza produrre versione. Le 12 generazioni riuscite sono partite dalle 19:30 in poi, tutte
con `refs: []`, tutte con il refset che continuava a promettere lo stile. **0 su 12** hanno
un riferimento nel lineage. La reference che l'utente aveva scelto come bersaglio non è mai
stata allegata, e il difetto è emerso solo dall'occhio umano sul risultato.

Perché fallire invece di degradare: un job che parte senza gli allegati promessi produce
un'immagine plausibile e sbagliata, che costa quota, minuti e giudizio umano su varianti che
non avevano nessuna possibilità di centrare il bersaglio. Un job che fallisce costa una riga
di errore.

#### Scenario: il file dichiarato non c'è
- **GIVEN** un job che dichiara un riferimento di stile
- **AND** quel file non è presente sul disco
- **WHEN** il job viene preso in carico
- **THEN** il job va in `failed` prima di inviare qualsiasi richiesta
- **AND** l'errore nomina il file mancante
- **AND** nessuna versione viene scritta e nessuna quota viene consumata

#### Scenario: i file dichiarati ci sono tutti
- **GIVEN** un job che dichiara un riferimento presente sul disco
- **WHEN** il job viene lavorato
- **THEN** il riferimento viene allegato alla richiesta
- **AND** la versione prodotta registra quel riferimento come ingresso

#### Scenario: uno su due manca
- **GIVEN** un job che dichiara due riferimenti, di cui uno assente
- **WHEN** il job viene preso in carico
- **THEN** fallisce nominando **solo** quello assente
- **AND** non viene generata un'immagine con il riferimento superstite

#### Scenario: job storico senza dichiarazione
- **GIVEN** uno dei 658 job di Japan con riferimenti allegati e nessuna dichiarazione
- **WHEN** viene lavorato
- **THEN** si comporta esattamente come prima di questo change
- **AND** i percorsi inesistenti continuano a essere scartati senza far fallire il job

#### Scenario: il refset promette e la dichiarazione è vuota
- **GIVEN** un job il cui `config.refset` contiene la parola "stile"
- **AND** nessun riferimento dichiarato né allegato
- **WHEN** il job viene preso in carico
- **THEN** il sistema segnala la contraddizione fra ciò che il refset promette e ciò che è
  allegato, invece di generare in silenzio
