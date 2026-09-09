import type { Checkpoint, WorkflowState, WorkflowProfile, Transition } from "../types.js";
import type { MilestoneProjection, ProjectionRef } from "./projections.js";
export declare const romans: readonly ["I", "II", "III", "IV", "V", "VI"];
export declare const titles: string[];
export declare const typeLabels: Record<string, string>;
export type PanelStatus = "待执行" | "待审核" | "阻塞" | "要求修改" | "进行中" | "待归档" | "已完成" | "已拒绝" | "一致性异常";
export interface WorkflowItem {
    key: string;
    root: string;
    project: string;
    archived: boolean;
    title: string;
    id: string;
    status: PanelStatus;
    updatedAt: string;
    issues: string[];
    approved: number;
    state?: WorkflowState;
    profile?: WorkflowProfile;
    transition?: Transition;
    legacy?: boolean;
}
export interface MilestoneView {
    roman: string;
    title: string;
    status: string;
    checkpoint?: Checkpoint;
    history: Checkpoint[];
    body: string;
    sections: Record<string, string>;
    file: string;
    token: string;
    issues: string[];
    plan?: any;
    model?: any;
    tasks?: string;
    projection?: MilestoneProjection;
    revisions?: ProjectionRef[];
    historical?: boolean;
}
/** All reads are bounded and confined to the selected physical change; no state migration on browse. */
export declare function safeRead(root: string, relative: string): Promise<string>;
export declare function readWorkflow(project: string, root: string, archived: boolean): Promise<WorkflowItem>;
/** Read-only scheduling projection, not a claim that an LLM is currently running. */
export declare function awaitingExecution(item: WorkflowItem): boolean;
export declare function milestoneCheckpoint(item: WorkflowItem, roman: string): Checkpoint | undefined;
export declare function milestoneStatus(item: WorkflowItem, roman: string): string;
export declare function discoverWorkflows(project: string): Promise<WorkflowItem[]>;
export declare function filterWorkflows(items: WorkflowItem[], query?: string, status?: string, type?: string): WorkflowItem[];
export declare function loadMilestone(item: WorkflowItem, index: number): Promise<MilestoneView>;
export declare function readProjection(item: WorkflowItem, ref: ProjectionRef): Promise<MilestoneProjection>;
export declare function historicalMilestone(item: WorkflowItem, current: MilestoneView, ref: ProjectionRef): Promise<MilestoneView>;
