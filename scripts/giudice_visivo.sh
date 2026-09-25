#!/usr/bin/env bash
# Giudice visivo: confronta una versione con la reference usando `claude -p`
# con visione vera (Read tool), non moondream.
#
# PERCHE'. Il 26/09 una sola lettura di claude -p ha trovato l'errore che le
# metriche e moondream avevano nascosto per ~35 generazioni: nella reference il
# viso e' illuminato da luce BIANCA calda, il blu e' solo di contorno. Moondream
# aveva risposto «storto» anche sul logo originale e «nessun problema» su layout
# rotti: come giudice della luce non regge.
#
# Uso: scripts/giudice_visivo.sh <candidata.png> [reference.png]
# Stampa un verdetto breve e un voto 1-10 di vicinanza alla luce della reference.
set -euo pipefail
CAND="${1:?candidata}"
REF="${2:-$HOME/Darkroom/projects/profilo/data/refs/luce-bg-studio-blu.png}"
cd /tmp
claude -p "Leggi con il Read tool due immagini: REFERENCE $REF e CANDIDATA $CAND. Sei un fotografo ritrattista e giudichi SOLO la luce e il colore della candidata rispetto alla reference, non l'identita'.
Rispondi in italiano, in questo formato esatto e niente altro:
VOTO: <1-10, quanto la luce della candidata e' vicina alla reference>
LUCE VISO: <una riga: colore e direzione della luce sul viso della candidata>
BLU: <una riga: dove sta il blu nella candidata e se e' come nella reference>
DIFETTI: <una riga: artefatti o cose che sembrano finte, o 'nessuno'>
CAMBIA: <una riga: la sola cosa che la avvicinerebbe di piu' alla reference>" --allowedTools Read
