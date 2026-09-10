/**
 * Se Chrome risponde, senza restarci ad aspettare.
 *
 * L'elenco dei progetti e quello degli strumenti dicono anche «Chrome non è
 * collegato». Per saperlo chiamavano il controllo vero, che apre il CDP (2s di
 * pazienza) e poi chiede alla pagina di calcolare `1+1` (altri 5): con Chrome acceso
 * ma impallato, aprire i Progetti costava sette secondi di attesa per una riga di
 * contorno. I progetti non hanno niente a che vedere con Chrome, e non devono
 * aspettarlo.
 *
 * Qui la risposta è sempre quella che si sa già, e il controllo vero riparte dietro
 * quando è invecchiata. Solo la primissima volta si aspetta, e poco: meglio dire
 * «non collegato» per un giro che tenere ferma la pagina.
 */
export type Controllo = () => Promise<boolean>;

export function creaSaluteBrowser(
  controllo: Controllo,
  { validitaMs = 10_000, budgetMs = 700 }: { validitaMs?: number; budgetMs?: number } = {},
) {
  let nota: { valore: boolean; quando: number } | null = null;
  let inCorso: Promise<boolean> | null = null;

  const aggiorna = (ora: number): Promise<boolean> => {
    inCorso ??= controllo()
      .catch(() => false)
      .then((v) => {
        nota = { valore: v, quando: Date.now() };
        inCorso = null;
        return v;
      });
    void ora;
    return inCorso;
  };

  return async function salute(): Promise<boolean> {
    const ora = Date.now();
    const fresca = nota !== null && ora - nota.quando < validitaMs;
    const lavoro = fresca ? null : aggiorna(ora);
    // C'è già una risposta: si dà quella e il controllo continua per conto suo.
    if (nota !== null) return nota.valore;
    // Primo giro e basta: si aspetta il controllo, ma non oltre il budget.
    return await Promise.race([
      lavoro!,
      new Promise<boolean>((r) => {
        const t = setTimeout(() => r(false), budgetMs);
        (t as unknown as { unref?: () => void }).unref?.();
      }),
    ]);
  };
}
