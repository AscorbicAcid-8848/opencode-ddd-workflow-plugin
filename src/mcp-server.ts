#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"

import { dddLifecycleTool } from "./index.js"

const actionSchema = z.enum([
  "init", "prepare", "evidence-bundle", "complete-stage", "review", "status",
  "block", "archive", "openspec", "openspec-plan",
])

const inputSchema = z.object({
  action: actionSchema,
  workflow_type: z.enum(["add-feature", "refactor-system", "create-system"]).optional(),
  workflow_id: z.string().min(1).optional(),
  project_root: z.string().min(1).optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  plan: z.record(z.string(), z.unknown()).optional(),
  mode: z.enum(["replace", "repair"]).optional(),
  skip_specs: z.boolean().optional(),
})

function structured(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== "string") return undefined
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

const server = new McpServer(
  { name: "ddd-workflow", version: "0.2.0" },
  {
    instructions: [
      "Use ddd_lifecycle as the sole authority for DDD stage progression.",
      "Call init once, then follow the returned transition through prepare, complete-stage and human review.",
      "Never hand-write formal milestone or OpenSpec artifacts.",
    ].join(" "),
  },
)

server.registerTool(
  "ddd_lifecycle",
  {
    title: "DDD lifecycle controller",
    description: "Persistent DDD workflow Harness. It owns routing, legal stage transitions, six human gates, OpenSpec planning, implementation evidence and archive. The model supplies only the current stage content.",
    inputSchema,
  },
  async (args) => {
    const cwd = args.project_root ? String(args.project_root) : process.cwd()
    const result = await dddLifecycleTool.execute(args as any, {
      sessionID: `codex-mcp-${process.pid}`,
      directory: cwd,
      worktree: cwd,
      agent: "ddd-workflow",
    } as any)
    const data = structured(result)
    const text = typeof result === "string" ? result : JSON.stringify(result)
    return {
      content: [{ type: "text" as const, text }],
      ...(data ? { structuredContent: data } : {}),
      isError: Boolean(data?.error),
    }
  },
)

const transport = new StdioServerTransport()
await server.connect(transport)
console.error("ddd-workflow MCP server listening on stdio")
