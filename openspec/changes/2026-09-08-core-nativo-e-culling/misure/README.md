# Misure — perché il core va scritto in Rust

Rifare i numeri, non fidarsi di questo file. 85 Sony ARW da 47 MB (42 MP), Mac 12 core,
page cache scaldata allo stesso modo per ogni concorrente.

```bash
D=/percorso/con/gli/ARW

# concorrente 1 — ImageIO in-process, la strada dell'app nativa (solo macOS)
swiftc -O imageio.swift -o imageio
./imageio $D 512 serial ; ./imageio $D 512 parallel

# concorrente 2 — il core proposto, multipiattaforma
cd rust && CC=/usr/bin/cc cargo build --release      # vedi nota su cc, sotto
./target/release/rustbench $D 512 serial ; ./target/release/rustbench $D 512 parallel

# concorrente 3 — quello che il nostro codice fa oggi (server/thumb.ts:34)
time for f in $D/*.ARW; do sips -Z 512 -s format jpeg "$f" --out /tmp/$(basename $f).jpg; done
```

## Risultati, 2026-09-08

| pipeline | seriale | parallelo |
|---|---:|---:|
| `sips` — nostro codice oggi | **1859 ms/foto** | — |
| ImageIO in-process (Swift, macOS) | 26,5 ms | 6,2 ms |
| Rust — questo prototipo | 24,6 ms | **7,9 ms** |
| Rust, sola decodifica senza ridimensionamento | — | 2,2 ms |

Il residuo contro ImageIO è tutto nel ridimensionamento: si chiude decodificando il JPEG a
scala DCT invece che pieno per poi rimpicciolire. Binario prodotto: 2,2 MB.

## Due trappole già pagate

**`kCGImageSourceCreateThumbnailFromImageAlways` ri-demosaicizza il RAW.** Con quel flag lo
stesso benchmark dava 505 ms/foto invece di 26,5: si stava misurando la decodifica piena,
non la lettura dell'anteprima. Serve `...FromImageIfAbsent`.

**La dimensione richiesta è un tetto, non un minimo.** Su queste ARW l'anteprima incorporata
è alta 1616 px: chiedendone 3840 ne tornano 1616. Per averne davvero 3840 serve la decodifica
piena, che costa **770 ms/foto — e parallelizzare non guadagna nulla** (779 ms in parallelo:
ImageIO satura già i core da sola). Sulle NEF Nikon il problema non si vede, perché lì
l'anteprima incorporata è grande quanto lo scatto. È il motivo per cui la soglia del livello
visore va misurata sulla cartella in esame e mai fissata come costante.

## Nota d'ambiente

`~/bin/cc` è il lanciatore tmux di Claude e fa ombra al compilatore C: qualunque build Rust
da shell interattiva fallisce al link con un messaggio che sembra un problema di Rust. Serve
`CC=/usr/bin/cc` e un `.cargo/config.toml` che punti il linker a `/usr/bin/cc`.
