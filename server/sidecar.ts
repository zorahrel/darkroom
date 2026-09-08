/** Il percorso del sidecar XMP di un file: stesso nome di base, estensione `.xmp`. */
export function percorsoSidecar(originale: string): string {
  return originale.replace(/\.[^./]+$/, "") + ".xmp";
}
