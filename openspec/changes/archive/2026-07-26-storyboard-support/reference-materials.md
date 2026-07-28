# Reference materials — storyboard prompt engineering

Materiale raccolto per informare `design.md` (in particolare la sezione sui preset del
prompt builder e sullo stile dei pannelli generati). Non normativo — spunti, non requisiti.

## Master prompt "CHILDHOOD STORY" (Google Doc)
https://docs.google.com/document/d/1aDt_0ddPfXhq0GNilhXUPsfVEtLTZWXUKFzWvpTJqLQ/edit?usp=drivesdk

Master prompt copy-paste per generare in **una sola immagine** un intero storyboard bible
sheet stile Pixar/Disney: title block, hero key art, griglia 7 scene (ognuna con
ACTION/CAMERA/LIGHTING/MOOD), character design sheet (turntable + expression strip), setting
design panel, color palette con hex, camera movement summary, lighting/mood summary, sound
design, narrative note — tutto composto in un unico layout da "production bible" con
istruzioni di stile molto specifiche (colori hex, font, disposizione %).

Rilevante per Darkroom: pattern alternativo al pannello-per-pannello — un singolo prompt
strutturato che produce un intero sheet riassuntivo. Spunto per un preset "storyboard sheet"
nel prompt builder (titolo/scene/personaggi come slot da compilare), o come riferimento di
stile per i pannelli generati singolarmente.

Nota tecnica: Google Docs `/edit` non è fetchabile via browser headless (ritorna solo shell
screen-reader); funziona `.../export?format=txt` via `curl` diretto (doc pubblico, no auth).

## Materiali simili trovati (ricerca 2026-07-22)

- **aetherwavestudio.com storyboard-image-prompts** — libreria curata gratuita di prompt
  "storyboard frame" copy-paste, compatibile con Midjourney/DALL-E/Flux/Nano Banana/SD,
  stile "bozzetto/matita con frecce di camera movement" (complementare al tono Pixar-finito
  della doc sopra).
  https://aetherwavestudio.com/static/ai-image-prompts/storyboard-image-prompts.html
- **ARTHUR-BBU/storyboard-director** (GitHub) — non un tool con GUI ma un **sistema di
  prompt/skill** (bilingue CN/EN) per portare un'idea vaga → storyboard visuale via LLM, con
  un proprio "shot vocabulary" e un "V2 system prompt" pensato per uso come companion skill.
  Concettualmente il più vicino a quanto Darkroom vuole fare via chat/MCP ("raccontami la
  storia, preparami lo storyboard") — utile per rubare la struttura del system prompt, non
  per il codice.
  https://github.com/ARTHUR-BBU/storyboard-director
- Altri risultati (tooljunction.io, promptspace.in, godofprompt.ai) sono prompt-builder
  generici per Midjourney/DALL-E, non specifici a storyboard — non approfonditi.
