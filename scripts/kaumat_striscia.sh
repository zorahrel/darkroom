#!/bin/zsh
# Dipinge la striscia della nuca sul Kaumat: un trattino color ruggine sul piano
# della testa, dove Attilio l'ha segnato con Annota (#2 e #4 su v16).
#
# PERCHE' A MANO. A parole il generatore l'ha sbagliata 9 volte su 10: in una
# ripresa da lontano e' il dettaglio piu' piccolo dell'immagine. Qui si tocca
# solo quella riga, e la pelle sotto resta la sua (Colorize + Overlay, bordo
# rotto dal rumore): pigmento, non vernice sopra.
#
# Uso: kaumat_striscia.sh <input.png> <output.png> "x1,y1 x2,y2" [spessore]
set -e
in=$1; out=$2; seg=$3; w=${4:-4.5}
t=$(mktemp -d)
read W H <<<"$(magick identify -format '%w %h' $in)"
magick -size ${W}x${H} xc:black -stroke white -strokewidth $w -draw "line ${seg}" -blur 0x1.0 \
  \( -size ${W}x${H} xc: +noise Random -colorspace gray -blur 0x0.7 -level 25%,85% \) \
  -compose multiply -composite -level 0,${LEVEL:-60}% $t/mask.png
magick -size ${W}x${H} xc:'#b4501c' $t/rust.png
magick $in -modulate 150,100,100 -level 0,90% $t/lift.png
magick $t/lift.png $t/rust.png -compose Colorize -composite \
  \( $in $t/rust.png -compose Overlay -composite \) -compose Blend -define compose:args=60 -composite $t/mix.png
magick $t/mix.png \( $t/mask.png -alpha off \) -compose CopyOpacity -composite $t/mixa.png
magick $in $t/mixa.png -compose over -composite $out
trash $t
