import type { WorkflowProfile } from "./types.js";
export interface DocSection {
    heading: string;
    subsections: string[];
}
export declare function overviewSubsections(): Record<string, string[]>;
export declare function sectionsFor(milestoneKey: string): Promise<DocSection[]>;
export declare function documentFileName(profile: WorkflowProfile, document: string): string;
export declare function documentPath(root: string, profile: WorkflowProfile, document: string): string;
export declare function generateSkeleton(profile: WorkflowProfile, milestoneKey: string, title: string): Promise<string>;
export declare function ensureSkeleton(root: string, profile: WorkflowProfile, milestoneKey: string): Promise<string>;
export declare function publishSections(root: string, profile: WorkflowProfile, milestoneKey: string, sections: Record<string, string>): Promise<string>;
