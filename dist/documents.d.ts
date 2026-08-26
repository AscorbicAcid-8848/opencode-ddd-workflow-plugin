import type { StageContract, WorkflowProfile } from "./types.js";
export interface DocSection {
    heading: string;
    subsections: string[];
}
export declare function overviewSubsections(): Record<string, string[]>;
/**
 * Orchestration-owned write policy. It deliberately lives outside all child
 * skill prompts: a stage can only replace the milestone sections for which it
 * is the decision owner.
 */
export declare function writableHeadingsForStage(stage: StageContract): string[];
export declare function sectionsFor(milestoneKey: string): Promise<DocSection[]>;
export declare function documentFileName(profile: WorkflowProfile, document: string): string;
export declare function documentPath(root: string, profile: WorkflowProfile, document: string): string;
export declare function generateSkeleton(profile: WorkflowProfile, milestoneKey: string, title: string): Promise<string>;
export declare function ensureSkeleton(root: string, profile: WorkflowProfile, milestoneKey: string): Promise<string>;
export declare function publishSections(root: string, profile: WorkflowProfile, milestoneKey: string, sections: Record<string, string>): Promise<string>;
export declare function renderSections(body: string, sections: Record<string, string>): string;
export declare function normalizeSectionContent(content: string): string;
export declare function unfilledHeadings(body: string): string[];
export declare function documentSections(body: string): Record<string, string>;
export declare function candidateDocument(root: string, profile: WorkflowProfile, milestoneKey: string, sections: Record<string, string>): Promise<string>;
