/**
 * L'altezza della barra in cima, in punti.
 *
 * Vive da sola, senza importazioni, perché la legge anche il guscio: `app/src/main.rs`
 * ci centra sopra i semafori della finestra, e la posizione dei semafori si può dare
 * solo alla costruzione della finestra — non c'è un modo di correggerla dopo, quindi
 * non si può misurare la pagina e adattarsi.
 *
 * Due numeri scritti a mano in due linguaggi si separano il giorno che qualcuno tocca
 * il padding della barra, e la separazione non si vede: i semafori scivolano di
 * qualche punto e nessun errore lo dice. Per questo il numero è uno solo e una prova
 * lo confronta con quello che sta in Rust.
 */
export const ALTEZZA_BARRA = 56.5;
