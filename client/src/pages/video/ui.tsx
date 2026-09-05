/**
 * The editor used its own pieces; now they belong to the whole app.
 *
 * The file remains as a doorway because the video pages import from here, but
 * the definition is single: two copies of the same button diverge at the first
 * tweak, and that is exactly how you end up with fourteen font sizes and six
 * different radii.
 */
export { Area, Bott, Field, Confirm, Toggle, NumberField, Choose, Checkbox, Badge, Header } from "../../ui";
export type { Weight, Size } from "../../ui";
