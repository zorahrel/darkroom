#!/bin/zsh
# inn.sh full edit geom out soglia  — innesto per differenza di colore (max canale)
t=$(mktemp -d); g=$3; wh=${g%%+*}; off=${g#*+}; x=${off%%+*}; y=${off#*+}
magick $1 -crop $g +repage $t/orig.png
magick $2 -resize ${wh}! $t/edit.png
magick $t/orig.png $t/edit.png -compose difference -composite -separate -evaluate-sequence Max -threshold ${5:-14}% -morphology Open Disk:1.5 -morphology Dilate Disk:5 -blur 0x3 $t/mask.png
magick $t/edit.png \( $t/mask.png -alpha off \) -compose CopyOpacity -composite $t/patch.png
magick $1 $t/patch.png -geometry +$x+$y -compose over -composite $4
rm -rf $t
