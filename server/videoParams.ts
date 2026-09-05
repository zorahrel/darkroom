import { DEFAULT_PARAMS } from "./comfy.ts";

/**
 * Generation parameters, as they actually arrive.
 *
 * They are accepted both ways: nested under `params`, or at the top level.
 *
 * Nested-only was the rule once, and whoever sent them at the top level (the
 * MCP server, and anyone reading the tool's signature) had them **silently
 * ignored**: ten generations asked for with different seeds all started with
 * the default one, which is five pairs of duplicates. A parameter that does not
 * arrive has to say so, hence the caller gets back both the values really
 * applied and the list of the names that were not recognised.
 *
 * This lives here, and not inline in the route, because the test that guards it
 * used to hold its own copy of these twenty lines: editing the route left the
 * test green, so the one bug it existed for could have come back untouched.
 */
export function normaliseVideoParams(body: Record<string, unknown>): {
  params: Record<string, unknown>;
  ignored: string[];
} {
  const raw: Record<string, unknown> = { ...((body.params as object) ?? {}) };
  const ignored: string[] = [];
  for (const [k, v] of Object.entries(body)) {
    if (["shot", "prompt", "take", "params", "project"].includes(k)) continue;
    if (k in DEFAULT_PARAMS) raw[k] = v;
    else ignored.push(k);
  }
  const params: Record<string, unknown> = {};
  for (const [k, expected] of Object.entries(DEFAULT_PARAMS)) {
    if (!(k in raw)) continue;
    const v = raw[k];
    if (typeof expected === "number") {
      const n = Number(v);
      if (!Number.isFinite(n)) {
        ignored.push(k);
        continue;
      }
      params[k] = n;
    } else params[k] = String(v);
  }
  return { params: { ...DEFAULT_PARAMS, ...params }, ignored };
}
