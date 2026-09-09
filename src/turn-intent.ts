export const turnIntents = new Map<string, "read-only" | "execute">()

/** Conservative turn-local intent. Unknown discussion is not execution permission. */
export function classifyTurn(text: string): "read-only" | "execute" {
  if (/^继续已有 DDD 工作流|^DDD 控制面板已通过工作流引擎保存以下人工审核结果/u.test(text)) return "execute"
  if (/^Load `ddd-(orchestrate|implementation)`/u.test(text)) {
    const request = text.trim().split(/\n\s*\n/u).at(-1) ?? ""
    return /到哪|哪个检查点|只读|进度|状态查询/iu.test(request) ? "read-only" : "execute"
  }
  if (/只读|不要.{0,6}(推进|执行|修改|继续)|不(提交|审核|归档)|到哪|哪个检查点|进度|状态查询|status|explain|where are we/iu.test(text)) return "read-only"
  if (/^\s*\/ddd(?:-code)?(?:\s|$)/u.test(text)) return "execute"
  if (/^(?:请|帮我|现在|好的|好，|好,|\s)*(?:继续|续跑|执行|开始|启动|实现|修复|修改|重构|新增|创建|批准|同意|通过|拒绝|退回|approve|continue|resume|implement|fix|go ahead)/iu.test(text)) return "execute"
  if (/使用\s*DDD\s*(重构|新增|创建)|继续已有 DDD 工作流|DDD 控制面板已通过工作流引擎保存以下人工审核结果/u.test(text)) return "execute"
  return "read-only"
}
