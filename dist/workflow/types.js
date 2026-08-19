export class WorkflowError extends Error {
    constructor(message) {
        super(message);
        this.name = "WorkflowError";
    }
}
export class WorkflowRuntimeError extends WorkflowError {
    code;
    operation;
    constructor(code, operation, message) {
        super(message);
        this.name = "WorkflowRuntimeError";
        this.code = code;
        this.operation = operation;
    }
}
//# sourceMappingURL=types.js.map