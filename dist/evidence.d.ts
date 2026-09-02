export interface EvidenceBundleOptions {
    /** Test seam and safety budget; production default is 2,000 source files. */
    fileLimit?: number;
}
export declare function evidenceBundle(projectRoot: string, workflowId: string, rawTerms: unknown, options?: EvidenceBundleOptions): Promise<Record<string, unknown>>;
