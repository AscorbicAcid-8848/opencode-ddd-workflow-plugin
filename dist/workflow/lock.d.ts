export interface WorkflowLockOptions {
    timeoutMs?: number;
    retryMs?: number;
    staleMs?: number;
    lockFile?: string;
}
export declare class WorkflowLockError extends Error {
    readonly code = "WORKFLOW_BUSY";
    readonly lockPath: string;
    constructor(lockPath: string);
}
/**
 * Serializes mutating operations for one workflow. OpenSpec already protects
 * its own registry writes; this lock protects the DDD projection and its
 * checkpoint/evidence bundle from two hosts writing concurrently.
 */
export declare function withWorkflowLock<T>(workflowRoot: string, operation: string, action: () => Promise<T>, options?: WorkflowLockOptions): Promise<T>;
export declare function readWorkflowLock(workflowRoot: string): Promise<Record<string, unknown> | null>;
