#!/usr/bin/env bun
/**
 * Darkroom MCP server.
 *
 * A thin stdio MCP wrapper over the local Darkroom REST API, so an MCP client
 * (e.g. Claude) can browse galleries, queue edits/generations, and manage
 * favorites. The Darkroom backend must be running (default http://localhost:3535).
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const API = (process.env.DARKROOM_API ?? "http://localhost:3535").replace(/\/$/, "");

async function call(
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
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
  return data;
}

type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, any>) => Promise<unknown>;
};

const tools: Tool[] = [
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
      call("GET", `/api/photos?filter=${encodeURIComponent(a.filter ?? "all")}`),
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
    handler: (a) => call("GET", `/api/photos/${encodeURIComponent(a.id)}`),
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
        });
      }
      return call("POST", `/api/photos/${encodeURIComponent(a.id)}/generate`);
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
      }),
  },
  {
    name: "generate_missing",
    description: "Queue an edit for every photo that has zero versions yet.",
    inputSchema: { type: "object", properties: {} },
    handler: () => call("POST", "/api/generate-missing"),
  },
  {
    name: "list_jobs",
    description: "Snapshot of the job queue (pending/running/done/failed).",
    inputSchema: { type: "object", properties: {} },
    handler: () => call("GET", "/api/jobs"),
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
      }),
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
      call("PUT", "/api/settings/global-prompt", { prompt: a.prompt }),
  },
  {
    name: "export_favorites",
    description: "Copy every favorite version into the final/ export folder.",
    inputSchema: { type: "object", properties: {} },
    handler: () => call("POST", "/api/export-favorites"),
  },
  // ---- Storyboard ---------------------------------------------------------
  // Enough to drive a board end-to-end from chat: describe the shots, keep the
  // cast consistent, re-order, then hand the file to Storyboarder.
  {
    name: "list_storyboard",
    description:
      "The active project's storyboard: panels in order (with duration, scene label and pinned characters), the cast, and the board settings.",
    inputSchema: { type: "object", properties: {} },
    handler: () => call("GET", "/api/storyboard"),
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
    handler: (a) => call("POST", "/api/storyboard/panels", { beats: a.beats }),
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
    handler: (a) => call("PUT", "/api/storyboard/sequence", { ids: a.ids }),
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
      return call("PATCH", `/api/storyboard/panels/${encodeURIComponent(id)}`, patch);
    },
  },
  {
    name: "list_characters",
    description: "The storyboard's cast: id, name, description and reference photo.",
    inputSchema: { type: "object", properties: {} },
    handler: () => call("GET", "/api/storyboard/characters"),
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
    handler: (a) => call("POST", "/api/storyboard/characters", a),
  },
  {
    name: "export_storyboard",
    description:
      "Write the board to Storyboarder's native format (.storyboarder + images/) under the project's final/ folder, ready to open in Storyboarder. Returns the file path.",
    inputSchema: { type: "object", properties: {} },
    handler: () => call("POST", "/api/storyboard/export"),
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
      }),
  },
  {
    name: "verification_summary",
    description:
      "Project-wide quality picture: how many renders were checked, what gets flagged and how often, and the hit rate over time (is the prompt tuning working?).",
    inputSchema: { type: "object", properties: {} },
    handler: () => call("GET", "/api/verify/summary"),
  },
  {
    name: "list_failure_modes",
    description:
      "The catalogue of known failure modes: what each one checks, whether it gates, and the clause it adds to the prompt.",
    inputSchema: { type: "object", properties: {} },
    handler: () => call("GET", "/api/verify/modes"),
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
    handler: (a) => call("POST", "/api/verify/modes", a),
  },
  {
    name: "status",
    description:
      "Backend health + ChatGPT browser status. Use launch=true to start the dedicated Chrome if it is offline.",
    inputSchema: {
      type: "object",
      properties: {
        launch: { type: "boolean", description: "Launch the browser if offline" },
      },
    },
    handler: async (a) => {
      if (a.launch) return call("POST", "/api/browser/launch");
      return call("GET", "/api/health");
    },
  },
];

const server = new Server(
  { name: "darkroom", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
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
