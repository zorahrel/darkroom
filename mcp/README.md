# Darkroom come strumento MCP

Un server [MCP](https://modelcontextprotocol.io) su stdio che espone l'API
locale di Darkroom a un client — Claude oggi, un'IA interna domani. È un
involucro sottile: il lavoro lo fa il backend, questo mappa strumenti → HTTP.

## Prima di tutto: il backend deve girare

```bash
launchctl kickstart -k gui/$(id -u)/com.jarvis.darkroom-backend   # servizio
bun run dev                                                        # oppure a mano
```

`DARKROOM_API` vale `http://localhost:3535`, come il backend web e Tauri.
Per un backend su un'altra porta, imposta esplicitamente questa variabile.

## Registrarlo

I server locali sono **figli del gateway**, mai stdio nello scope utente: uno
stdio user-scope si moltiplica per ogni sessione aperta.

```
gateway_mount {
  name: "darkroom",
  transport: "stdio",
  command: "bun",
  args: ["/absolute/path/to/darkroom/mcp/server.ts"],
  env: { "DARKROOM_API": "http://localhost:3535" }
}
```

Poi gli strumenti si chiamano `darkroom__<nome>`.

## Il progetto

**Ogni strumento accetta `project`.** Senza, si lavora sul progetto
predefinito: comodo in una sessione sola, sbagliato appena i progetti sono
quattro e non si sa su quale si è finiti. Chi automatizza lo passa sempre.

Si comincia da `list_projects`: dà l'`id` che tutti gli altri vogliono, le
viste accese, e i numeri di testa (foto/preferite/versioni, oppure
tagli/riprese/durata per un progetto video).

Quattro strumenti non lo hanno perché non ha senso: `list_projects`,
`add_project`, `update_project` e `status` (il generatore è uno solo per tutta
la macchina).

## Che cosa c'è

| famiglia | strumenti |
|---|---|
| progetti | `list_projects` `add_project` `update_project` (rinomina, accende/spegne le viste, ferma il generatore su quel progetto) |
| foto | `list_photos` `get_photo` `edit_photo` `generate_image` `generate_missing` `set_favorite` `set_global_prompt` `export_favorites` `list_jobs` |
| controlli foto | `check_photo` `verification_summary` `list_failure_modes` `add_failure_mode` |
| storyboard | `list_storyboard` `create_panels` `set_sequence` `update_panel` `list_characters` `set_character` `export_storyboard` |
| montaggio | `video_shots` `video_cuts` `video_judge` `video_pin` `video_duration` `video_forcings` `video_rebuild` `video_rebuild_status` `video_check` `video_generate` `video_generations` |
| macchina | `status` |

## Due cose da sapere sul montaggio

**Il piano è derivato.** Tagli sulle battute misurate, ripresa scelta per
durezza misurata, niente doppioni per costruzione. `video_judge` scarta una
ripresa e il piano si rifà da solo: non c'è nient'altro da sistemare a mano.
`video_pin` e `video_duration` scavalcano il calcolo, e per questo sono
**dichiarate** — compaiono nell'interfaccia fra «le tue scelte» e si disfano.
Leggi `video_forcings` prima di ricostruire.

**Ricostruire costa.** `video_rebuild` gira sul PC con la 3090, circa dodici
minuti, e torna subito: si segue con `video_rebuild_status`. `video_check` è la
stessa misura che mostra l'interfaccia, non una seconda implementazione — la
correlazione fra durezza del suono e durezza dell'immagine dev'essere almeno
0,85.

**Generare una ripresa ha un tetto vero.** I valori predefiniti di
`video_generate` (640×1152, 61 fotogrammi, 20 passi, a tasselli) sono quelli
che entrano nella memoria della scheda. A 704×1280 con 81 fotogrammi la 3090
arriva a 23,9 GB su 24,5 e si pianta: un'ora, zero PNG.

## Registro delle chiamate

La voce **Registro** nella barra apre `/activity`. L'endpoint di lettura è
`GET /api/mcp-log`: filtri `tool`, `outcome=ok|errore`, `project`, paginazione
con `before` (id esclusivo) e `limit` (1–100, predefinito 50). La risposta contiene
`entries`, `next_before`, l'elenco `tools` e i limiti `retention`.

Un unico decoratore registra anche errori di rete e strumenti sconosciuti nella
tabella `mcp_log` del database globale `DARKROOM_DB` (altrimenti `GALLERY_ROOT/photos.db`), senza dipendere dall'HTTP. MCP e backend
devono quindi condividere configurazione `GALLERY_ROOT`, `DARKROOM_DB` e
`DARKROOM_REGISTRY`; cambiare solo `DARKROOM_API` non sposta il registro su un altro
computer. Per le chiamate globali il progetto è nullo; per le altre è quello
risolto dal backend e restituito nell'header `x-darkroom-project`. Creazione,
aggiornamento e avvio di strumenti annotano il progetto coinvolto. Se il backend
è irraggiungibile, resta il destinatario richiesto; togliere un progetto da Studio
non cambia la posizione del registro.

Gli argomenti vengono salvati con credenziali, chiavi e percorsi oscurati, anche
quando ricompaiono nei messaggi di errore. I risultati completi non vengono
copiati nel registro. Il tetto è **5.000 chiamate / 30 giorni**, potato sia alla
scrittura sia alla lettura; ciascuna voce limita argomenti a 16 KiB e messaggio
a 2 KiB. SQLite riutilizza le pagine liberate dalle righe eliminate.

L'esito riguarda la chiamata: accodare una generazione riuscita non significa che
il lavoro sia già terminato. Se il disco non permette di registrare, il chiamante
riceve un avviso senza trasformare una scrittura riuscita in un invito a ripeterla.
