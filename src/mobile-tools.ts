// Mobile Coder exposes configured custom tools through a generic `mcp` slot.
// Export the exact same OpenCode SDK tool object so both hosts share one engine.
export { dddLifecycleTool as default, dddLifecycleTool } from "./index.js"
