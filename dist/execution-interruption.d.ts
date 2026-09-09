export declare function readExecutionInterruption(root: string, state: any): Promise<any>;
export declare function isInterruptedReply(messages: any[]): any;
/** No model calls or business state mutations. Idle is not workflow completion. */
export declare function createInterruptionMonitor(project: string, client: any): (sessionID: string) => Promise<void>;
