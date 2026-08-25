import path from "node:path"
import { tool, type Plugin } from "@opencode-ai/plugin"
import { initialize, prepare, submit, review, status, archive, openspec, workflowTransition } from "./engine.js"
import { profileFor } from "./catalog.js"
import { loadState } from "./state.js"
import { workflowRoot, statePath } from "./state.js"
import { exists } from "./fs.js"
import type { WorkflowType, LifecycleAction, ReviewDecision, OpenSpecArtifact } from "./types.js"

const workflowType = tool.schema.enum(["add-feature", "refactor-system", "create-system"])
const lifecycleAction = tool.schema.enum(["init", "prepare", "submit", "review", "status", "archive", "openspec"])
const reqText = () => tool.schema.string().min(1)

function projectRoot(args: { project_root?: string }, ctx: { worktree?: string; directory?: string }) {
  return path.resolve(args.project_root || ctx.worktree || ctx.directory || process.cwd())
}

function identity(args: { workflow_type: WorkflowType; workflow_id: string; project_root?: string }, ctx: { worktree?: string; directory?: string }) {
  return { workflowType: args.workflow_type, workflowId: args.workflow_id, projectRoot: projectRoot(args, ctx) }
}

async function resolveActiveIdentity(ctx: { worktree?: string; directory?: string }, workflowType?: WorkflowType, workflowId?: string): Promise<{ workflowType: WorkflowType; workflowId: string; projectRoot: string }> {
  const root = path.resolve(ctx.worktree || ctx.directory || process.cwd())
  if (workflowType && workflowId) return { workflowType, workflowId, projectRoot: root }
  const { readdir } = await import("node:fs/promises")
  const changesDir = path.join(root, "openspec", "changes")
  const candidates: string[] = []
  if (await exists(changesDir)) {
    for (const entry of await readdir(changesDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "archive") continue
      const ddd = path.join(changesDir, entry.name, "ddd")
      if (await exists(statePath(ddd))) candidates.push(entry.name)
    }
  }
  if (candidates.length === 1) {
    const state = await loadState(path.join(changesDir, candidates[0], "ddd"))
    return { workflowType: state.workflowType, workflowId: state.workflowId, projectRoot: root }
  }
  if (candidates.length === 0) throw new Error("当前项目没有活动的 DDD change；请先用 action=init 创建。")
  throw new Error(`当前项目有多个活动 DDD change（${candidates.join("、")}），请显式传 workflow_type 与 workflow_id。`)
}

const out = (v: unknown) => JSON.stringify(v, null, 2)

export const DddWorkflowPlugin: Plugin = async (pluginInput) => {
  return {
    async config(config) {
      // soft: no hard restrictions injected into host config
    },
    async "command.execute.before"(input) {
      // mark DDD sessions for soft protection only
    },
    async "tool.execute.before"(input, hookOutput) {
      const args = hookOutput.args as Record<string, any> | undefined
      // Soft protection: warn (not hard-stop) when editing milestone docs directly.
      if (input.tool === "edit" || input.tool === "write" || input.tool === "apply_patch" || input.tool === "patch" || input.tool === "multiedit") {
        const target = String(args?.filePath ?? args?.path ?? "")
        if (target && /ddd\/(?:I|II|III|IV|IV|V|VI)-[a-z-]+\.md$/i.test(target)) {
          // Soft warning only; do not throw. LLM is trusted to use ddd_lifecycle submit.
          hookOutput.args = { ...args }
        }
      }
    },
    tool: {
      ddd_lifecycle: tool({
        description: "DDD 工作流生命周期控制器。唯一用于推进 DDD 六里程碑工作流的工具。action 取值：init|prepare|submit|review|status|archive|openspec。始终依据返回的 transition 决定下一步，不要从文件推断状态。",
        args: {
          action: lifecycleAction,
          workflow_type: workflowType.optional().describe("init 必填；其余当项目仅有一个活动 change 时可省略。"),
          workflow_id: reqText().optional().describe("init 必填；其余当项目仅有一个活动 change 时可省略。"),
          project_root: tool.schema.string().optional().describe("项目根目录，默认取会话 worktree。"),
          input: tool.schema.record(tool.schema.string(), tool.schema.any()).optional().describe("动作载荷。init:{title,request}; prepare:{stage?}; submit:{stage,summary,sections}; review:{stage,decision,reviewer,feedback?}; status:{view?}; archive:{}; openspec:{artifact}。"),
        },
        async execute(args, context) {
          try {
            const ctx = { worktree: (context as any).worktree, directory: (context as any).directory }
            if (args.action === "init") {
              const i = args.input as Record<string, any> | undefined
              if (!args.workflow_type || !args.workflow_id || !i?.title || !i?.request) {
                return out({ error: "init 需要 workflow_type、workflow_id 和 input.{title,request}。" })
              }
              return out(await initialize({ workflowType: args.workflow_type, workflowId: args.workflow_id, projectRoot: projectRoot(args, ctx), title: i.title, request: i.request }))
            }
            const id = await resolveActiveIdentity(ctx, args.workflow_type, args.workflow_id)
            if (args.action === "prepare") {
              const i = (args.input as Record<string, any> | undefined) ?? {}
              return out(await prepare({ ...id, stage: i.stage }))
            }
            if (args.action === "submit") {
              const i = args.input as Record<string, any> | undefined
              if (!i?.stage || !i?.summary || !i?.sections) {
                return out({ error: "submit 需要 input.{stage,summary,sections}。" })
              }
              return out(await submit({ ...id, stage: i.stage, summary: i.summary, sections: i.sections, plannedSlices: i.plannedSlices, sliceId: i.sliceId }))
            }
            if (args.action === "review") {
              const i = args.input as Record<string, any> | undefined
              if (!i?.stage || !i?.decision || !i?.reviewer) {
                return out({ error: "review 需要 input.{stage,decision,reviewer}。" })
              }
              return out(await review({ ...id, stage: i.stage, decision: i.decision as ReviewDecision, reviewer: i.reviewer, feedback: i.feedback }))
            }
            if (args.action === "status") {
              const i = (args.input as Record<string, any> | undefined) ?? {}
              return out(await status({ ...id, view: i.view }))
            }
            if (args.action === "archive") {
              return out(await archive(id))
            }
            if (args.action === "openspec") {
              const i = args.input as Record<string, any> | undefined
              if (!i?.artifact) return out({ error: "openspec 需要 input.artifact。" })
              return out(await openspec({ ...id, artifact: i.artifact as OpenSpecArtifact }))
            }
            return out({ error: `未知 action：${args.action}` })
          } catch (error) {
            return out({ error: (error as Error).message, errorType: (error as Error).name })
          }
        },
      }),
    },
  }
}

export default DddWorkflowPlugin
