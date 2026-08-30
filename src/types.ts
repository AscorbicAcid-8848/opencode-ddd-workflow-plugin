export type WorkflowType = "add-feature" | "refactor-system" | "create-system"
export type ReviewDecision = "approve" | "revise" | "reject"
export type OpenSpecArtifact = "proposal" | "specs" | "design" | "tasks" | "apply"
export type LifecycleAction = "init" | "prepare" | "evidence-bundle" | "complete-stage" | "section" | "finalize" | "submit" | "review" | "status" | "block" | "archive" | "openspec" | "openspec-plan"

export interface HumanDecisionResolution {
  selectedCandidateId?: string
  resolvedDecisions?: string[]
  selections?: Record<string, string>
}

export interface DecisionOption {
  id: string
  label: string
  impact?: string
}

export interface DecisionItem {
  id: string
  ownerStage: string
  question: string
  options: DecisionOption[]
  recommendationId?: string
  status: "open" | "resolved" | "deferred" | "out-of-scope"
  blocks: string[]
  sourceRefs: string[]
  selectedOptionId?: string
  selectedOptionLabel?: string
  resolvedAt?: string
  resolvedBy?: string
  deferredToStage?: string
}

export interface DeliveryPlanState {
  source: "structured-openspec-plan"
  sliceIds: string[]
  dependencies: Record<string, string[]>
  completedSliceIds: string[]
  approvedAt?: string
}

export interface StageContract {
  id: string
  document: string
  skills?: string[]
  checklist?: string[]
  humanGate?: boolean
  criticalGate?: string
  adviceRequired?: boolean
  reviewTitle?: string
  repeatable?: boolean
  cycleGroup?: string
  openspecArtifactGate?: boolean
  openspecTaskTracking?: boolean
  openspecArchiveGate?: boolean
  openSpecAction?: string
  deliveryAssetGate?: boolean
  implementationEvidence?: boolean
  requiresCompletedImplementation?: boolean
  qualityContract?: { minSectionChars?: number; minSummaryChars?: number; requiredContent?: string[] }
  scopeContract?: { id: string }
  [key: string]: unknown
}

export interface MilestoneContract {
  roman: string
  document: string
  title: string
}

export interface WorkflowProfile {
  title: string
  skill: string
  artifactBase: string
  artifactSubdir?: string
  artifactLanguage?: string
  stages: StageContract[]
  milestones: MilestoneContract[]
  strategicBaselineContract?: boolean
  designConformanceContract?: boolean
  documents: Record<string, string>
  documentTitles: Record<string, string>
  [key: string]: unknown
}

export interface ReviewRecord {
  decision: ReviewDecision
  reviewer: string
  reviewedAt: string
  feedback: string
}

export interface Checkpoint {
  checkpointId: number
  stage: string
  milestone: string
  summary: string
  status: "completed" | "awaiting_review" | "approved" | "revision_requested" | "rejected" | "superseded"
  review: ReviewRecord | null
  reviewTitle?: string
  reviewChecklist: string[]
  adviceRequired: boolean
  document: string
  completedAt: string
  plannedSlices?: number
  completedSlices?: number
  sliceId?: string
  ambiguityResolution?: unknown
  decisionItems?: DecisionItem[]
  humanReviewSummary?: string
}

export interface WorkflowState {
  schemaVersion: string
  workflowType: WorkflowType
  workflowId: string
  title: string
  originalRequest?: string
  projectRoot: string
  artifactRoot: string
  status: "active" | "revision_requested" | "rejected" | "runtime_blocked" | "awaiting_archive" | "complete"
  currentStage: string
  createdAt: string
  updatedAt: string
  runtimeSessionId?: string
  preparedStage?: {
    stage: string
    preparedAt: string
  }
  checkpoints: Checkpoint[]
  openSpec?: { changeId?: string; archivedAt?: string; status?: string }
  runtimeBlock?: { stage: string; reason: string; evidence: string[]; remediation: string[]; blockedAt: string }
  implementationBaseline?: { head: string; capturedAt: string }
  deliveryPlan?: DeliveryPlanState
  decisionLedger?: DecisionItem[]
  humanDecisions?: Array<{
    milestone: string
    stage: string
    selectedCandidateId?: string
    candidateLabel?: string
    resolvedDecisions: string[]
    deferredToTacticalFamilies?: string[]
    feedback?: string
    reviewer: string
    decidedAt: string
  }>
  [key: string]: unknown
}

export interface Transition {
  schemaVersion: "ddd-workflow-transition/v1"
  workflowStatus: string
  lastCompletedStage: string | null
  stageRole: "not-started" | "milestone-building" | "human-gate" | "complete" | "blocked" | "archive"
  milestoneRoman: string | null
  milestoneTitle: string | null
  milestoneReady: boolean
  milestoneStatus: string
  documentRole: "cumulative-working-document" | "human-review-document" | "none"
  humanReviewRequired: boolean
  mustContinue: boolean
  stopAllowed: boolean
  stopReason: string | null
  nextStage: string | null
  allowedNextStages: string[]
  nextHumanGate: string | null
  requiredAction: "continue" | "select-next-stage" | "await-human-review" | "revise" | "stop" | "archive" | "complete"
  message: string
}

export interface ValidationFinding {
  code: string
  path: string
  message: string
  severity: "blocking" | "warning"
  suggestion?: string
}

export type ClaimMaturity = "fact" | "hypothesis" | "candidate" | "proposed" | "implemented" | "verified"

export interface StageClaim {
  id: string
  kind: string
  statement: string
  maturity: ClaimMaturity
  documentSection: string
  authorityRefs: string[]
  evidenceRefs: string[]
  attributes?: Record<string, unknown>
}

export interface StageClaimContract {
  required: boolean
  allowedKinds: string[]
  allowedMaturities: ClaimMaturity[]
  evidenceRequiredKinds: string[]
  authorityPrefixes: string[]
  evidencePrefixes: string[]
  rules: string[]
}

export class WorkflowError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WorkflowError"
  }
}

export interface Identity {
  workflowType: WorkflowType
  workflowId: string
  projectRoot: string
}
