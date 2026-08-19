export declare const now: () => string;
export declare function exists(file: string): Promise<boolean>;
export declare function atomicText(file: string, content: string): Promise<void>;
export declare function atomicBytes(file: string, content: Uint8Array): Promise<void>;
export declare function readJson<T>(file: string): Promise<T>;
export declare function writeJson(file: string, value: unknown): Promise<void>;
export declare function sha256(file: string): Promise<string>;
export declare function fileEvidence(file: string, relativeTo: string): Promise<{
    path: string;
    sha256: string;
    bytes: number;
}>;
export declare function walkFiles(root: string, relative?: string): Promise<string[]>;
export declare function snapshot(root: string): Promise<Record<string, {
    sha256: string;
    bytes: number;
}>>;
export declare function run(executable: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): Promise<{
    stdout: string;
    stderr: string;
}>;
