export declare const protectedMilestonePatterns: string[];
export declare function isProtectedMilestonePath(projectRoot: string, candidate: string): boolean;
export declare function protectedMutationTargets(toolName: string, args: unknown, projectRoot: string): string[];
export declare function guardMilestoneMutation(toolName: string, args: unknown, projectRoot: string): void;
export declare function injectMilestoneEditProtection(config: Record<string, any>): void;
