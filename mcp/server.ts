#!/usr/bin/env bun
/**
 * Darkroom MCP server.
 *
 * Un involucro stdio sopra l'API locale di Darkroom, cosi' un client MCP —
 * Claude oggi, l'IA interna domani — puo' fare quello che si fa a mano
 * dall'interfaccia: sfogliare le gallerie, mettere in coda le generazioni,
 * giudicare le riprese di un montaggio, ricostruire il video e leggere la
 * barra dei controlli.
 *
 * Due cose che qui contano piu' che altrove.
 *
 * **Il progetto.** Ogni strumento accetta `project`. Senza, si lavora su
 * quello predefinito — comodo in una sessione sola, sbagliato appena i
 * progetti sono quattro e non si sa su quale si e' finiti. Chi automatizza
 * dovrebbe passarlo sempre.
 *
 * **La porta.** Il valore scritto qui e' l'ultima spiaggia: il server vero
 * gira dove dice il suo servizio launchd, ed e' li' che si guarda. `3535` era
 * scritto a mano e il server ascoltava sulla 3737 — l'MCP non ha mai risposto
 * a nessuno.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const API = (process.env.DARKROOM_API ?? "http://localhost:3737").replace(/\/$/, "");

/**
 * Una scrittura risponde con una RICEVUTA, non con lo stato del progetto.
 *
 * Le rotte che scrivono restituiscono anche `shots` (64 riprese con dentro
 * descrittori, giudizi e problemi) perche' la UI se ne serve per aggiornarsi
 * senza un secondo giro. Passarlo cosi' com'e' a chi chiama via MCP vuol dire
 * rispondere a «ho tenuto questa ripresa» con 247.000 caratteri: misurato il
 * 27/08/2026 su video_judge, che per questo era inusabile proprio dal posto
 * per cui esiste. Chi vuole l'elenco chiama video_shots.
 */
export function ricevuta(d: unknown): unknown {
  if (!d || typeof d !== "object") return d;
  const o = { ...(d as Record<string, unknown>) };
  for (const grosso of ["shots", "cuts", "pictures", "segments"]) {
    const v = o[grosso];
    if (Array.isArray(v)) o[grosso] = `${v.length} voci — chiedile con video_shots/video_cuts`;
  }
  return o;
}

async function call(
  method: string,
  path: string,
  body?: unknown,
  project?: string,
): Promise<unknown> {
  const headers: Record<string, string> = {};
  if (body) headers["content-type"] = "application/json";
  // Il progetto viaggia in un'intestazione, non nel percorso: cosi' ogni
  // strumento resta una riga e non c'e' da ricordarsi di appendere `?project=`
  // in venti posti diversi (dimenticarlo in uno vuol dire scrivere nel
  // progetto sbagliato, in silenzio).
  if (project) headers["x-darkroom-project"] = project;
  const res = await fetch(`${API}${path}`, {
    method,
    headers: Object.keys(headers).length ? headers : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* keep raw text */
  }
  if (!res.ok) {
    throw new Error(
      `${method} ${path} → ${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`,
    );
  }
  return method === "POST" ? ricevuta(data) : data;
}

type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, any>) => Promise<unknown>;
  /** Uno strumento che non ha senso limitare a un progetto (l'elenco, la
   *  salute del backend) non si porta dietro il campo. */
  globale?: boolean;
};

/** Il campo `project`, aggiunto a ogni strumento che non e' globale. */
const PROJECT_FIELD = {
  project: {
    type: "string",
    description:
      "Id del progetto su cui lavorare (da list_projects). Senza, si usa quello predefinito.",
  },
} as const;

/** Esportato per il test che tiene allineati catalogo e strumenti: un
 *  catalogo che dimentica uno strumento nuovo torna a essere una brochure. */
export const tools: Tool[] = [
  {
    name: "list_photos",
    description:
      "List gallery photos. Optional filter: all | no_versions | with_versions | no_favorite | with_favorite | in_queue | failed.",
    inputSchema: {
      type: "object",
      properties: {
        filter: { type: "string", description: "Filter (default: all)" },
      },
    },
    handler: (a) =>
      call("GET", `/api/photos?filter=${encodeURIComponent(a.filter ?? "all")}`, undefined, a.project),
  },
  {
    name: "get_photo",
    description:
      "Get one photo with its versions, the effective prompt, and config.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
    handler: (a) => call("GET", `/api/photos/${encodeURIComponent(a.id)}`, undefined, a.project),
  },
  {
    name: "edit_photo",
    description:
      "Queue an edit of an existing photo. If `prompt` is given it becomes the photo's per-photo prompt override; otherwise the current effective prompt is used.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        prompt: { type: "string", description: "Optional custom prompt" },
      },
      required: ["id"],
    },
    handler: async (a) => {
      if (typeof a.prompt === "string" && a.prompt.trim()) {
        await call("PUT", `/api/photos/${encodeURIComponent(a.id)}/prompt`, {
          prompt: a.prompt,
        }, a.project);
      }
      return call("POST", `/api/photos/${encodeURIComponent(a.id)}/generate`, undefined, a.project);
    },
  },
  {
    name: "generate_image",
    description:
      "Generate brand-new image(s) from a text prompt (no source photo). Returns the created photo ids.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        count: { type: "number", description: "How many variations (1-50, default 1)" },
      },
      required: ["prompt"],
    },
    handler: (a) =>
      call("POST", "/api/generate-new", {
        prompt: a.prompt,
        count: a.count ?? 1,
      }, a.project),
  },
  {
    name: "generate_missing",
    description: "Queue an edit for every photo that has zero versions yet.",
    inputSchema: { type: "object", properties: {} },
    handler: (a) => call("POST", "/api/generate-missing", undefined, a.project),
  },
  {
    name: "list_jobs",
    description: "Snapshot of the job queue (pending/running/done/failed).",
    inputSchema: { type: "object", properties: {} },
    handler: (a) => call("GET", "/api/jobs", undefined, a.project),
  },
  {
    name: "set_favorite",
    description:
      "Set (or clear) the favorite version of a photo. Pass version_id, or null to clear.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        version_id: { type: ["number", "null"] },
      },
      required: ["id"],
    },
    handler: (a) =>
      call("PUT", `/api/photos/${encodeURIComponent(a.id)}/favorite`, {
        version_id: a.version_id ?? null,
      }, a.project),
  },
  {
    name: "set_global_prompt",
    description: "Set the global default prompt used for edits.",
    inputSchema: {
      type: "object",
      properties: { prompt: { type: "string" } },
      required: ["prompt"],
    },
    handler: (a) =>
      call("PUT", "/api/settings/global-prompt", { prompt: a.prompt }, a.project),
  },
  {
    name: "export_favorites",
    description: "Copy every favorite version into the final/ export folder.",
    inputSchema: { type: "object", properties: {} },
    handler: (a) => call("POST", "/api/export-favorites", undefined, a.project),
  },
  // ---- Storyboard ---------------------------------------------------------
  // Enough to drive a board end-to-end from chat: describe the shots, keep the
  // cast consistent, re-order, then hand the file to Storyboarder.
  {
    name: "list_storyboard",
    description:
      "The active project's storyboard: panels in order (with duration, scene label and pinned characters), the cast, and the board settings.",
    inputSchema: { type: "object", properties: {} },
    handler: (a) => call("GET", "/api/storyboard", undefined, a.project),
  },
  {
    name: "create_panels",
    description:
      "Turn a beat sheet into storyboard panels: one generated panel per beat, appended to the board with its generation already queued. Each beat: {description, duration_ms?, scene_label?, character_ids?}.",
    inputSchema: {
      type: "object",
      properties: {
        beats: {
          type: "array",
          description: "Shots to draw, in order",
          items: {
            type: "object",
            properties: {
              description: { type: "string", description: "What happens in this shot" },
              duration_ms: { type: "number", description: "Panel duration in ms (default 3000)" },
              scene_label: { type: "string", description: 'e.g. "INT. BAR - NIGHT"' },
              character_ids: {
                type: "array",
                items: { type: "string" },
                description: "Characters in frame (see list_characters)",
              },
            },
            required: ["description"],
          },
        },
      },
      required: ["beats"],
    },
    handler: (a) => call("POST", "/api/storyboard/panels", { beats: a.beats }, a.project),
  },
  {
    name: "set_sequence",
    description:
      "Re-order the whole board: the given photo ids become panels 0..N-1, in that order. Pure DB write — never queues generation.",
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" }, description: "Panel ids, in the wanted order" },
      },
      required: ["ids"],
    },
    handler: (a) => call("PUT", "/api/storyboard/sequence", { ids: a.ids }, a.project),
  },
  {
    name: "update_panel",
    description:
      "Change one panel's duration, scene label, or pinned characters.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        duration_ms: { type: "number" },
        scene_label: { type: ["string", "null"] },
        character_ids: { type: "array", items: { type: "string" } },
      },
      required: ["id"],
    },
    handler: (a) => {
      const { id, ...patch } = a;
      return call("PATCH", `/api/storyboard/panels/${encodeURIComponent(id)}`, patch, a.project);
    },
  },
  {
    name: "list_characters",
    description: "The storyboard's cast: id, name, description and reference photo.",
    inputSchema: { type: "object", properties: {} },
    handler: (a) => call("GET", "/api/storyboard/characters", undefined, a.project),
  },
  {
    name: "set_character",
    description:
      "Create or update a character. A reference_photo_id makes its look stick across panels: that image is attached to every generation the character appears in.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        id: { type: "string", description: "Defaults to a slug of the name" },
        reference_photo_id: { type: ["string", "null"], description: "Photo id used as the visual reference" },
        description: { type: ["string", "null"], description: 'e.g. "teen girl, red coat"' },
      },
      required: ["name"],
    },
    handler: (a) => call("POST", "/api/storyboard/characters", a, a.project),
  },
  {
    name: "export_storyboard",
    description:
      "Write the board to Storyboarder's native format (.storyboarder + images/) under the project's final/ folder, ready to open in Storyboarder. Returns the file path.",
    inputSchema: { type: "object", properties: {} },
    handler: (a) => call("POST", "/api/storyboard/export", undefined, a.project),
  },
  // ---- Quality control ----------------------------------------------------
  // The gate reports; it never changes a favorite or deletes a render.
  {
    name: "check_photo",
    description:
      "Run the quality checks on every render of a photo (burnt highlights, crushed blacks, near-duplicates, plus vision questions like garbled signage or watermarks). Returns a report per render and which one the checks prefer.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        only: {
          type: "array",
          items: { type: "string" },
          description: "Restrict to these failure-mode codes",
        },
      },
      required: ["id"],
    },
    handler: (a) =>
      call("POST", `/api/verify/photos/${encodeURIComponent(a.id)}`, {
        only: a.only,
      }, a.project),
  },
  {
    name: "verification_summary",
    description:
      "Project-wide quality picture: how many renders were checked, what gets flagged and how often, and the hit rate over time (is the prompt tuning working?).",
    inputSchema: { type: "object", properties: {} },
    handler: (a) => call("GET", "/api/verify/summary", undefined, a.project),
  },
  {
    name: "list_failure_modes",
    description:
      "The catalogue of known failure modes: what each one checks, whether it gates, and the clause it adds to the prompt.",
    inputSchema: { type: "object", properties: {} },
    handler: (a) => call("GET", "/api/verify/modes", undefined, a.project),
  },
  {
    name: "add_failure_mode",
    description:
      "Turn a recurring complaint into a check: a yes/no question asked of every new render, plus an optional clause added to the prompt's 'Do not' block. Also used to edit or disable an existing one.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "lowercase_with_underscores" },
        label: { type: "string" },
        question: {
          type: "string",
          description: "Yes/no question about the image, e.g. 'Is the sky washed out? Answer yes or no.'",
        },
        negative_clause: {
          type: "string",
          description: "Clause added to the prompt, e.g. 'do not wash out the sky'",
        },
        gate_enabled: { type: "boolean", description: "Run it automatically (default true)" },
      },
      required: ["code"],
    },
    handler: (a) => call("POST", "/api/verify/modes", a, a.project),
  },
  // ---- progetti ----------------------------------------------------------
  // Senza questi, un client MCP lavorava alla cieca sul progetto predefinito:
  // non poteva sapere quali esistessero ne' sceglierne uno.
  {
    name: "list_projects",
    description:
      "Every project on this machine: id, name, folder, which views are on, whether the generator works on it, and its headline numbers (photos/favorites/versions, or cuts/shots/duration for a video project). Start here: the `id` is what every other tool's `project` argument takes.",
    inputSchema: { type: "object", properties: {} },
    globale: true,
    handler: () => call("GET", "/api/studio/projects"),
  },
  {
    name: "add_project",
    description:
      "Create a project. `kind` is the view you land on (photo | storyboard | video); `views` is everything it can do — a project can be photo AND video. `photos.path` indexes a folder right away (mode 'link' leaves the files where they are).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        kind: { type: "string", description: "photo | storyboard | video (default photo)" },
        views: { type: "array", items: { type: "string" }, description: "Views to switch on" },
        root: { type: "string", description: "Existing folder; omitted, Darkroom makes one" },
        photos: {
          type: "object",
          properties: { path: { type: "string" }, mode: { type: "string", description: "link | copy" } },
        },
      },
      required: ["name"],
    },
    globale: true,
    handler: (a) => call("POST", "/api/studio/projects", a),
  },
  {
    name: "update_project",
    description:
      "Change a project: rename it, switch views on/off (`views`), move the landing view (`kind`), or stop the generator from picking up its jobs (`active: false` — queued work stays queued, nothing is lost).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        kind: { type: "string" },
        views: { type: "array", items: { type: "string" } },
        active: { type: "boolean" },
      },
      required: ["id"],
    },
    globale: true,
    handler: (a) => {
      const { id, ...patch } = a;
      return call("PATCH", `/api/studio/projects/${encodeURIComponent(id)}`, patch);
    },
  },

  // ---- montaggio video ----------------------------------------------------
  // Il lato video non esisteva qui: un client MCP vedeva solo le foto, mentre
  // meta' del lavoro (giudicare le riprese, forzare un taglio, ricostruire) si
  // poteva fare solo a mano.
  {
    name: "video_shots",
    description:
      "Every shot of a video project: its measured hardness, which act it belongs to, whether it is in the cut, and whether you already judged it. This is what a judging pass reads.",
    inputSchema: { type: "object", properties: { ...PROJECT_FIELD } },
    handler: (a) => call("GET", "/api/video/shots", undefined, a.project),
  },
  {
    name: "video_cuts",
    description:
      "The montage as it stands: every cut with its bar, time, duration, shot, speed, and the two hardness numbers (sound vs picture) the choice was derived from. Plus BPM, total duration and the acts.",
    inputSchema: { type: "object", properties: { ...PROJECT_FIELD } },
    handler: (a) => call("GET", "/api/video/cuts", undefined, a.project),
  },
  {
    name: "video_judge",
    description:
      "Keep or discard a shot. Discarding takes it out of the montage at the next rebuild — the plan is derived, so nothing else has to be adjusted by hand. Say WHY in `perche`: it is what makes a discard reviewable later.",
    inputSchema: {
      type: "object",
      properties: {
        shot: { type: "string" },
        kept: { type: "boolean" },
        why: { type: "string", description: "Why, in your own words" },
        ...PROJECT_FIELD,
      },
      required: ["shot", "kept"],
    },
    handler: (a) =>
      call("POST", "/api/video/pick", { shot: a.shot, kept: a.kept, why: a.why }, a.project),
  },
  {
    name: "video_pin",
    description:
      "Force a specific shot onto a bar, overriding the derived choice. `shot: null` releases it. Declared, not hidden: it shows in the UI among 'your choices' and is undoable.",
    inputSchema: {
      type: "object",
      properties: {
        bar: { type: "number" },
        shot: { type: ["string", "null"] },
        ...PROJECT_FIELD,
      },
      required: ["bar"],
    },
    handler: (a) => call("POST", "/api/video/pin", { bar: a.bar, shot: a.shot ?? null }, a.project),
  },
  {
    name: "video_duration",
    description:
      "Force how many bars a cut lasts (half-bar steps). `battute: null` gives it back to the derived plan.",
    inputSchema: {
      type: "object",
      properties: {
        bar: { type: "number" },
        bars: { type: ["number", "null"] },
        ...PROJECT_FIELD,
      },
      required: ["bar"],
    },
    handler: (a) =>
      call("POST", "/api/video/durata", { bar: a.bar, bars: a.bars ?? null }, a.project),
  },
  {
    name: "video_forcings",
    description:
      "Everything decided by hand on this montage — pinned bars, forced durations, discarded shots — i.e. exactly what overrides the measurements. Read it before rebuilding.",
    inputSchema: { type: "object", properties: { ...PROJECT_FIELD } },
    handler: (a) => call("GET", "/api/video/overrides", undefined, a.project),
  },
  {
    name: "video_rebuild",
    description:
      "Rebuild the video with the current choices. Heavy work: it runs on the PC with the 3090, about twelve minutes. Returns immediately — follow it with video_rebuild_status.",
    inputSchema: { type: "object", properties: { ...PROJECT_FIELD } },
    handler: (a) => call("POST", "/api/video/ricostruisci", undefined, a.project),
  },
  {
    name: "video_rebuild_status",
    description:
      "Whether a rebuild is running, how far along it is, the TAIL of its log, and its exit code when it ends. The log is cut to the last `righe` lines (20 by default) because the whole thing is 60.000 characters and a rebuild is checked many times: ask for more only when something went wrong.",
    inputSchema: {
      type: "object",
      properties: {
        rows: {
          type: "number",
          description: "How many trailing log lines to return (default 20, 0 for the whole log)",
        },
        ...PROJECT_FIELD,
      },
    },
    handler: async (a) => {
      const d = (await call("GET", "/api/video/rebuild", undefined, a.project)) as {
        active?: boolean; log?: string; output?: number | null; iniziata?: number | null;
      };
      const rows = typeof a.rows === "number" ? a.rows : 20;
      const log = (d.log ?? "").replace(/\r/g, "");
      // Quante riprese sono state montate sulle 64: la riga della fonderia e'
      // "  nome  159 frame ->  52 quadri", una per ripresa. E' l'unica cosa che
      // si vuole davvero sapere mentre gira, e nella coda del log non si vede
      // perche' la coda dice solo dove sta adesso, non quanta strada ha fatto.
      const done = (log.match(/^ {2}\S+ +\d+ frame -> +\d+ quadri/gm) ?? []).length;
      const attese = (log.match(/^ {2}\S+ +\d+ frame sorgente$/gm) ?? []).length;
      const tutte = log.split("\n");
      return {
        active: d.active,
        output: d.output ?? null,
        avanzamento: attese ? `${done}/${attese} riprese montate` : null,
        minuti: d.iniziata ? +((Date.now() - d.iniziata) / 60000).toFixed(1) : null,
        log: rows > 0 ? tutte.slice(-rows).join("\n") : log,
        log_troncato: rows > 0 && tutte.length > rows ? `${tutte.length - rows} righe prima` : null,
      };
    },
  },
  {
    name: "video_check",
    description:
      "Run the checks on the built video and return each one with its measured value: cuts on measured beats, no duplicate shots, the correlation between sound hardness and picture hardness (must be at least 0.85), and the rest. This is the bar — it is the same measurement the UI shows, not a second implementation.",
    inputSchema: {
      type: "object",
      properties: {
        force: { type: "boolean", description: "Re-measure instead of using the cached result" },
        ...PROJECT_FIELD,
      },
    },
    handler: (a) => call("GET", `/api/video/gate${a.force ? "?force=1" : ""}`, undefined, a.project),
  },
  {
    name: "video_generate",
    description:
      "Generate a new shot on the 3090 through ComfyUI. Defaults are the ones that actually fit in the card's memory (640x1152, 61 frames, 20 steps, tiled): asking for more has produced an hour of nothing and zero frames.",
    inputSchema: {
      type: "object",
      properties: {
        shot: { type: "string", description: "Name of the shot to create" },
        prompt: { type: "string" },
        width: { type: "number" },
        height: { type: "number" },
        length: { type: "number", description: "Frames" },
        steps: { type: "number" },
        ...PROJECT_FIELD,
      },
      required: ["shot", "prompt"],
    },
    handler: (a) => {
      const { project, ...corpo } = a;
      return call("POST", "/api/video/generate", corpo, project);
    },
  },
  {
    name: "video_generations",
    description: "The shot generations: running, done and failed, with their logs.",
    inputSchema: { type: "object", properties: { ...PROJECT_FIELD } },
    handler: (a) => call("GET", "/api/video/generatetions", undefined, a.project),
  },

  // ---- colore, foto, post -------------------------------------------------
  // Esistevano solo nell'interfaccia: chi guidava Darkroom da fuori poteva
  // generare e giudicare, ma non dire di che colore, ne' da quale cartella
  // vengono le foto, ne' in quale post finiscono. Tre buchi che rendevano
  // falsa la frase "si fa tutto anche da qui".
  {
    name: "color_grade",
    description:
      "The project's colour development (3D LUT, white balance, sky, match). Called bare it reads the current chain and the LUTs available; with `grade` it writes it. The look is one for the whole set — the same chain the grid previews and the export bakes.",
    inputSchema: {
      type: "object",
      properties: {
        grade: {
          type: "object",
          description:
            "The full grade to store: { enabled, steps: [...] }. Read it first, change what you need, send it back.",
        },
      },
    },
    handler: async (a) => {
      if (a.grade) return call("PUT", "/api/settings/color-grade", { grade: a.grade }, a.project);
      const [grade, luts] = await Promise.all([
        call("GET", "/api/settings/color-grade", undefined, a.project),
        call("GET", "/api/luts", undefined, a.project),
      ]);
      return { ...(grade as object), luts: (luts as { luts?: unknown[] }).luts };
    },
  },
  {
    name: "add_photos",
    description:
      "Point the project at a folder of photos. mode 'link' (default) indexes them where they are and copies nothing; 'copy' brings them into the project — for a card or a downloads folder you will empty.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        mode: { type: "string", description: "link | copy (default link)" },
      },
      required: ["path"],
    },
    handler: (a) => call("POST", "/api/sources", { path: a.path, mode: a.mode ?? "link" }, a.project),
  },
  {
    name: "rescan_photos",
    description: "Re-read the project's photo folders, picking up files added since.",
    inputSchema: { type: "object", properties: {} },
    handler: (a) => call("POST", "/api/sources/rescan", undefined, a.project),
  },
  {
    name: "list_collections",
    description:
      "The project's collections (posts/carousels): each one's title, caption, cover and how many photos are in it — plus how many are actually publishable, which differs when a photo was refused and will never have a render.",
    inputSchema: { type: "object", properties: {} },
    handler: (a) => call("GET", "/api/collections", undefined, a.project),
  },
  {
    name: "assign_photos",
    description:
      "Move photos into a collection, appended in the given order. `collection_id: null` takes them out of every collection. Membership is exclusive, so a photo can't silently go out twice.",
    inputSchema: {
      type: "object",
      properties: {
        photo_ids: { type: "array", items: { type: "string" } },
        collection_id: { type: ["string", "null"] },
      },
      required: ["photo_ids"],
    },
    handler: (a) =>
      call("POST", "/api/collections/assign", {
        photo_ids: a.photo_ids,
        collection_id: a.collection_id ?? null,
      }),
  },

  // ---- il catalogo --------------------------------------------------------
  // Sopra le chiamate c'e' il mestiere. Questi due danno a chi arriva la
  // stessa mappa che vede un umano sulla home, invece di trentasette primitive
  // da cui dedurre cosa sa fare il programma.
  {
    name: "list_tools",
    description:
      "What Darkroom can do, as capabilities rather than endpoints: for each one what it is for, which project views it lives in, which MCP tools drive it, whether it is usable RIGHT NOW on this machine (and if not, what is missing and how to fix it), and how to start it. Read this first when you don't know where to begin — it is the same catalogue the home page shows.",
    inputSchema: {
      type: "object",
      properties: {
        area: {
          type: "string",
          description: "Only one area: immagini | colore | qualita | libreria | racconto | montaggio | sistema",
        },
        pronti: { type: "boolean", description: "Only the ones usable right now" },
      },
    },
    globale: true,
    handler: async (a) => {
      const d = (await call("GET", "/api/tools")) as {
        areas: unknown[];
        backend: string;
        requirements: Record<string, { ok: boolean; how: string }>;
        tools: any[];
      };
      const picked = d.tools
        .filter((s) => (a.area ? s.area === a.area : true))
        .filter((s) => (a.pronti ? s.ready : true));
      return {
        backend: d.backend,
        requirements: d.requirements,
        // Compatto di proposito: lo schema intero di ventun strumenti e' un
        // manuale, e chi chiede "cosa sai fare" non lo sta leggendo.
        tools: picked.map((s) => ({
          id: s.id,
          name: s.name,
          what: s.what,
          area: s.area,
          views: s.views,
          mcp: s.mcp,
          ready: s.ready,
          missing: s.missing?.map((m: { how: string }) => m.how) ?? [],
          start: s.starters
            .filter((v: { mode: string }) => v.mode !== "open")
            .map((v: { mode: string; label: string; fields: { name: string; required?: boolean }[] }) => ({
              mode: v.mode,
              label: v.label,
              fields: v.fields.map((cx) => (cx.required ? `${cx.name}*` : cx.name)),
            })),
        })),
      };
    },
  },
  {
    name: "start_tool",
    description:
      "Start one of the tools from list_tools in a single call: it does the work (creating the project it needs, if it needs one) and answers with what happened and the page to land on. Pass the tool id and its fields — `campi` in list_tools, a star meaning required. Without `project` it works on the default one, like every other tool here.",
    inputSchema: {
      type: "object",
      properties: {
        tool: { type: "string", description: "Tool id from list_tools" },
        values: {
          type: "object",
          description: 'The tool\'s fields, e.g. { prompt: "…", conta: 4 }',
        },
        project: {
          type: "string",
          description: "Which project to work on (ignored by the tools that create their own)",
        },
      },
      required: ["tool"],
    },
    globale: true,
    handler: (a) =>
      call("POST", `/api/tools/${encodeURIComponent(a.tool)}/avvia`, {
        project: a.project,
        values: a.values ?? {},
      }),
  },

  {
    name: "status",
    description:
      "Backend health + ChatGPT browser status. Use launch=true to start the dedicated Chrome if it is offline. The generator is shared by every project, so this one has no `project`.",
    inputSchema: {
      type: "object",
      properties: {
        launch: { type: "boolean", description: "Launch the browser if offline" },
      },
    },
    globale: true,
    handler: async (a) => {
      if (a.launch) return call("POST", "/api/browser/launch", undefined, a.project);
      return call("GET", "/api/health", undefined, a.project);
    },
  },
];

const server = new Server(
  { name: "darkroom", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map(({ name, description, inputSchema, globale }) => ({
    name,
    description,
    // Aggiunto qui una volta sola: scriverlo in venti schemi vuol dire
    // scordarselo in uno, e quello scrive nel progetto sbagliato in silenzio.
    inputSchema: globale
      ? inputSchema
      : {
          ...inputSchema,
          properties: { ...(inputSchema as any).properties, ...PROJECT_FIELD },
        },
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const tool = tools.find((t) => t.name === req.params.name);
  if (!tool) {
    return {
      isError: true,
      content: [{ type: "text", text: `unknown tool: ${req.params.name}` }],
    };
  }
  try {
    const result = await tool.handler(req.params.arguments ?? {});
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `error: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[darkroom-mcp] connected — API ${API}`);
