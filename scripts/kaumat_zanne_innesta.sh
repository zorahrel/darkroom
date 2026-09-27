#!/bin/zsh
# Rimette nel fotogramma intero il ritaglio del muso modificato da kaumat_zanne.ts,
# ma SOLO dove il ritaglio e' cambiato davvero (differenza > soglia, poi aperta,
# dilatata e sfumata): cosi' le zanne entrano e il resto del muso resta
# l'originale al pixel, anche se il modello ha ridisegnato impercettibilmente.
#
# Uso: kaumat_zanne_innesta.sh <intero.png> <ritaglio_modificato.png> <WxH+X+Y> <uscita.png>
set -e
full=$1; edit=$2; geom=$3; out=$4
t=$(mktemp -d)
wh=${geom%%+*}; off=${geom#*+}; x=${off%%+*}; y=${off#*+}
magick $full -crop $geom +repage $t/orig.png
magick $edit -resize ${wh}! $t/edit.png
magick $t/orig.png $t/edit.png -compose difference -composite -colorspace gray \
  -threshold ${SOGLIA:-18}% -morphology Open Disk:1.5 -morphology Dilate Disk:6 -blur 0x4 $t/mask.png
magick $t/edit.png \( $t/mask.png -alpha off \) -compose CopyOpacity -composite $t/patch.png
magick $full $t/patch.png -geometry +$x+$y -compose over -composite $out
trash $t
