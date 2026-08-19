import { mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
export class WorkflowLockError extends Error {
    code = "WORKFLOW_BUSY";
    lockPath;
    constructor(lockPath) {
        super(`工作流正在被另一个进程修改：${lockPath}`);
        this.name = "WorkflowLockError";
        this.lockPath = lockPath;
    }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/**
 * Serializes mutating operations for one workflow. OpenSpec already protects
 * its own registry writes; this lock protects the DDD projection and its
 * checkpoint/evidence bundle from two hosts writing concurrently.
 */
export async function withWorkflowLock(workflowRoot, operation, action, options = {}) {
    const lockPath = options.lockFile ?? path.join(workflowRoot, ".ddd", "workflow.lock");
    const timeoutMs = options.timeoutMs ?? 5000;
    const retryMs = options.retryMs ?? 50;
    const staleMs = options.staleMs ?? 10 * 60 * 1000;
    await mkdir(path.dirname(lockPath), { recursive: true });
    const started = Date.now();
    let handle;
    while (!handle) {
        try {
            handle = await open(lockPath, "wx");
            await writeFile(handle, JSON.stringify({ pid: process.pid, operation, acquiredAt: new Date().toISOString() }) + "\n", "utf8");
        }
        catch (error) {
            if (error.code !== "EEXIST")
                throw error;
            try {
                const lockStat = await stat(lockPath);
                if (Date.now() - lockStat.mtimeMs > staleMs)
                    await rm(lockPath, { force: true });
            }
            catch (staleCheckError) {
                if (staleCheckError.code !== "ENOENT")
                    throw staleCheckError;
            }
            if (Date.now() - started >= timeoutMs)
                throw new WorkflowLockError(lockPath);
            await sleep(retryMs);
        }
    }
    try {
        return await action();
    }
    finally {
        await handle.close();
        await rm(lockPath, { force: true });
    }
}
export async function readWorkflowLock(workflowRoot) {
    const lockPath = path.join(workflowRoot, ".ddd", "workflow.lock");
    try {
        return JSON.parse(await readFile(lockPath, "utf8"));
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=lock.js.map