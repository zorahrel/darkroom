/**
 * L'editor usava i suoi pezzi; adesso sono di tutta l'app.
 *
 * Il file resta come porta d'ingresso perché le pagine video lo importano da
 * qui, ma la definizione è una sola: due copie dello stesso bottone divergono
 * al primo ritocco, ed è esattamente come si finisce con quattordici misure di
 * carattere e sei raggi diversi.
 */
export { Area, Bott, Field, Confirm, Toggle, NumberField, Scegli, Checkbox, Badge, Header } from "../../ui";
export type { Weight, Taglia } from "../../ui";
