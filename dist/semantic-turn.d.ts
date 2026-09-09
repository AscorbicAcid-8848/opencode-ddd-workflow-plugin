type Intent = 'query' | 'clarify' | 'start' | 'continue' | 'approve' | 'revise' | 'reject';
export declare const pendingCommands: Map<string, string>;
export declare function beginSemanticTurn(sessionID: string, messageID: string, text: string, locked?: boolean): void;
export declare function clearSemanticTurn(sessionID: string): void;
export declare function declareIntent(sessionID: string, input: any): {
    error: string;
    intent?: undefined;
    accepted?: undefined;
    alreadyDeclared?: undefined;
    scope?: undefined;
    requiresClarification?: undefined;
} | {
    intent: Intent;
    accepted: boolean;
    alreadyDeclared: boolean;
    error?: undefined;
    scope?: undefined;
    requiresClarification?: undefined;
} | {
    accepted: boolean;
    intent: any;
    scope: string;
    requiresClarification: boolean;
    error?: undefined;
    alreadyDeclared?: undefined;
};
export declare function intentError(sessionID: string, action: string, decision?: string): "DDD_INTENT_REQUIRED: 先用 action=intent 理解本轮用户请求。" | "DDD_READ_ONLY_TURN: 本轮仅查询或澄清，不推进。" | "DDD_REVIEW_NOT_AUTHORIZED: 本轮没有新的当前检查点审核授权。" | "DDD_REVIEW_DECISION_MISMATCH: 操作与本轮审核意图不一致。" | "DDD_INIT_NOT_AUTHORIZED: 本轮不允许创建另一工作流。" | "DDD_REVIEW_SCOPE: 先完成审核；仅在用户要求继续时推进到下一个人工检查点。" | undefined;
export declare function bindIntentWorkflow(sessionID: string, workflow: string, checkpoint?: number): void;
export declare function finishIntentReview(sessionID: string): void;
export declare function reviewMustStop(sessionID: string): boolean;
export {};
