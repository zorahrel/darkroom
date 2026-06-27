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
