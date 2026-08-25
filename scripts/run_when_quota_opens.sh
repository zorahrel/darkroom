#!/bin/bash
# Aspetta la riapertura della quota ChatGPT e lancia la passata "insieme".
#
# Detached apposta (nohup + disown): la sessione che lo lancia puo' chiudersi,
# e la quota riapre lo stesso. Un job legato alla sessione avrebbe chiesto di
# tenere aperto un terminale per quattro ore.
set -u
RESETS_AT="${1:-$(cat "$HOME/.cache/darkroom-fav/quota_resets_at" 2>/dev/null || echo 0)}"
LOG="$HOME/.cache/darkroom-fav/insieme.log"
mkdir -p "$(dirname "$LOG")"

now=$(date +%s)
wait=$(( RESETS_AT - now + 120 ))   # due minuti di margine: il server arrotonda
[ "$wait" -gt 0 ] && { echo "[$(date '+%F %T')] dormo ${wait}s fino alla riapertura" >> "$LOG"; sleep "$wait"; }

cd "$HOME/Projects/darkroom" || exit 1
echo "[$(date '+%F %T')] parto: 3 sorgenti insieme, NESSUN riferimento, 5 ricette, 3 giri" >> "$LOG"
# Il rubinetto lento non e' prudenza: senza, il sito limita l'accesso e smette
# di generare del tutto (25/08, 9 lavori persi in fila).
DARKROOM_PACE=30 $HOME/.bun/bin/bun run scripts/gen_variants.ts profilo \
  --insieme --senza-refs --giri 4 >> "$LOG" 2>&1   # canale codex: alle 21:14 la sua quota e' riaperta
code=$?
echo "[$(date '+%F %T')] finito (exit $code)" >> "$LOG"
# exit 2 = quota di nuovo esaurita: lo dice il generatore, non si insiste.

# Colpo singolo: si sfila da launchd invece di ripresentarsi ogni sera. Un job
# che si ripete da solo e' come il waiter che ha bruciato 222 generazioni.
launchctl bootout "gui/$(id -u)/com.jarvis.darkroom-insieme" 2>/dev/null
exit $code
