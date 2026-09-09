import type { MilestoneView, WorkflowItem } from "./model.js";
export declare const viewGroups: string[][];
export declare const clean: (text: string) => string;
export interface VisualEdge {
    from: string;
    to: string;
    label: string;
    candidate: boolean;
}
export interface VisualCard {
    title: string;
    body: string;
    kind: "event" | "domain" | "model" | "evidence" | "warning" | "info";
    edges?: VisualEdge[];
}
export declare function explicitEdges(source: string): VisualEdge[];
/** Interpret only explicit Mermaid edges. Unsupported notation remains visible as source, never inferred. */
export declare function diagramText(source: string): string;
export declare function visualCards(item: WorkflowItem, view: MilestoneView, index: number): VisualCard[];
export declare function decisionText(view: MilestoneView, language?: "zh" | "en"): string;
