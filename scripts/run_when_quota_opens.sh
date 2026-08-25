#!/bin/bash
# Aspetta la riapertura della quota ChatGPT e lancia la passata "insieme".
#
# Detached apposta (nohup + disown): la sessione che lo lancia puo' chiudersi,
# e la quota riapre lo stesso. Un job legato alla sessione avrebbe chiesto di
# tenere aperto un terminale per quattro ore.
set -u
RESETS_AT="${1:?serve l'epoch di riapertura}"
LOG="$HOME/.cache/darkroom-fav/insieme.log"
mkdir -p "$(dirname "$LOG")"

now=$(date +%s)
wait=$(( RESETS_AT - now + 120 ))   # due minuti di margine: il server arrotonda
[ "$wait" -gt 0 ] && { echo "[$(date '+%F %T')] dormo ${wait}s fino alla riapertura" >> "$LOG"; sleep "$wait"; }

cd "$HOME/Projects/darkroom" || exit 1
echo "[$(date '+%F %T')] parto: 3 sorgenti insieme, 5 ricette, 3 giri" >> "$LOG"
$HOME/.bun/bin/bun run scripts/gen_variants.ts profilo \
  --refs style-bw-wet-hair-hardlight.png --insieme --giri 3 >> "$LOG" 2>&1
code=$?
echo "[$(date '+%F %T')] finito (exit $code)" >> "$LOG"
# exit 2 = quota di nuovo esaurita: lo dice il generatore, non si insiste.
