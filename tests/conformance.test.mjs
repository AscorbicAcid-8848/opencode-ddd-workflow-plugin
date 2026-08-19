import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { validateImplementationEvidence } from "../dist/workflow/conformance.js"

function run(executable, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, windowsHide: true, shell: false })
    let stdout = "", stderr = ""
    child.stdout.on("data", (chunk) => { stdout += chunk })
    child.stderr.on("data", (chunk) => { stderr += chunk })
    child.on("close", (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr || stdout)))
  })
}
const git = (cwd, ...args) => run("git", ["-C", cwd, ...args], cwd)
const hash = async (file) => createHash("sha256").update(await readFile(file)).digest("hex")

test("TypeScript engine validates Git, model, architecture, test and E2E evidence", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "ddd-ts-conformance-"))
  try {
    const root = path.join(project, "openspec", "changes", "native-engine", "ddd")
    const delivery = path.join(root, ".ddd", "delivery")
    await mkdir(path.join(project, "src", "domain"), { recursive: true })
    await mkdir(path.join(project, "tests"), { recursive: true })
    await mkdir(delivery, { recursive: true })
    await writeFile(path.join(project, "src", "domain", "Order.ts"), "export class Order {}\n")
    await writeFile(path.join(project, "tests", "Order.test.ts"), "// baseline\n")
    await git(project, "init"); await git(project, "config", "user.email", "ddd@example.com"); await git(project, "config", "user.name", "DDD Test")
    await git(project, "add", "src", "tests"); await git(project, "commit", "-m", "baseline")
    const baseline = await git(project, "rev-parse", "HEAD")
    await writeFile(path.join(project, "src", "domain", "Order.ts"), "export class Order { place() { return 'placed' } }\n")
    await writeFile(path.join(project, "tests", "Order.test.ts"), "// passed order placement\n")
    await git(project, "add", "src", "tests"); await git(project, "commit", "-m", "feat: place order")
    const implementation = await git(project, "rev-parse", "HEAD")
    const tactical = path.join(root, "IV-tactical-design.md")
    await writeFile(tactical, "# approved tactical design\n")
    const contract = {
      schema: "ddd-model-conformance/v1", workflowId: "native-engine", workflowType: "add-feature", status: "approved", conformanceMode: "strict",
      tacticalDesign: { path: "IV-tactical-design.md", sha256: await hash(tactical) },
      architecture: { layoutStrategy: "package-by-feature", cyclePolicy: "forbid", modules: [{ id: "ordering", boundedContexts: ["Ordering"], sourceRoots: ["src"], testRoots: ["tests"], namespacePrefixes: ["app.ordering"], publishedLanguagePrefixes: ["app.ordering.contract"], layers: [{ id: "domain", kind: "domain", pathPrefixes: ["src/domain"], namespacePrefixes: ["app.ordering.domain"], allowedLayerIds: ["domain"], forbiddenImportPrefixes: ["infra"] }] }], moduleDependencies: [], approvedLegacyExceptions: [], verification: { requiredCommands: ["npm test"] } },
      elements: [{ id: "ME-AGG-001", kind: "aggregate", name: "Order", responsibility: "place order", implementationForm: "dedicated-type", moduleId: "ordering", layerId: "domain", productionPaths: ["src/domain/Order.ts"], testPaths: ["tests/Order.test.ts"], coveredByItems: ["slice-1"] }],
      invariants: [{ id: "INV-001", statement: "Order placed once", ownerElementId: "ME-AGG-001", acceptanceCriteria: ["AC-1"] }], deferredElements: [],
    }
    const contractFile = path.join(delivery, "model-contract.json")
    await writeFile(contractFile, `${JSON.stringify(contract, null, 2)}\n`)
    const evidence = {
      schema: "ddd-implementation-evidence/v2", workflowId: "native-engine", stage: "09-implementation", sliceId: "place-order",
      baselineSha: baseline, implementationSha: implementation, commitSha: implementation,
      acceptanceCriteria: ["AC-1"], changedPaths: ["src/domain/Order.ts", "tests/Order.test.ts"], productionPaths: ["src/domain/Order.ts"], testPaths: ["tests/Order.test.ts"], consumerPaths: ["src/domain/Order.ts"],
      verification: [{ command: "npm test", exitCode: 0, resultSummary: "passed" }], runtimeEvidence: [{ kind: "integration", result: "passed", reference: "Order.test.ts" }],
      testEvidence: { coverage: { acceptanceCriteria: ["AC-1"], invariants: ["INV-001"], mappings: [{ targetId: "AC-1", testPaths: ["tests/Order.test.ts"], command: "npm test", result: "passed" }, { targetId: "INV-001", testPaths: ["tests/Order.test.ts"], command: "npm test", result: "passed" }], uncovered: [] }, levels: ["domain", "application", "integration", "architecture", "e2e"].map((level) => ({ level, testPaths: ["tests/Order.test.ts"], command: "npm test", result: "passed" })), e2e: { result: "passed", command: "npm test", testPaths: ["tests/Order.test.ts"], realConsumerPaths: ["src/domain/Order.ts"], mockPolicy: "no-business-path-mocks", environment: "test", reference: "Order.test.ts" } },
      designConformance: { modelContractSha256: await hash(contractFile), modelElementIds: ["ME-AGG-001"], invariantIds: ["INV-001"], deviations: [], summary: "The approved aggregate and invariant are implemented." },
      compatibility: "Existing behavior remains compatible.", rollback: `git revert ${implementation}`,
    }
    const evidenceFile = path.join(root, ".ddd", "implementation-evidence", "place-order.json")
    await mkdir(path.dirname(evidenceFile), { recursive: true }); await writeFile(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`)
    const state = { workflowId: "native-engine", workflowType: "add-feature", projectRoot: project, artifactRoot: root }
    const result = await validateImplementationEvidence(root, state, "09-implementation", evidenceFile)
    assert.equal(result.architectureConformance.result, "passed")
    assert.deepEqual(result.architectureConformance.checkedPaths, ["src/domain/Order.ts"])
    evidence.testEvidence.e2e.mockPolicy = "mock-business-path"
    await writeFile(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`)
    await assert.rejects(validateImplementationEvidence(root, state, "09-implementation", evidenceFile), /E2E.*真实业务链路/)
  } finally {
    await rm(project, { recursive: true, force: true })
  }
})
