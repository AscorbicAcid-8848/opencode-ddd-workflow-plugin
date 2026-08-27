import { test } from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const serverPath = path.resolve(here, "../dist/mcp-server.js")

test("Codex MCP adapter exposes exactly one lifecycle tool", async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: [serverPath] })
  const client = new Client({ name: "ddd-mcp-test", version: "1.0.0" })
  try {
    await client.connect(transport)
    const result = await client.listTools()
    assert.deepEqual(result.tools.map((tool) => tool.name), ["ddd_lifecycle"])
    assert.equal(result.tools[0].inputSchema.required.includes("action"), true)
  } finally {
    await client.close()
  }
})
