export declare const now: () => string;
export declare function exists(file: string): Promise<boolean>;
export declare function atomicText(file: string, content: string): Promise<void>;
export declare function readJson<T>(file: string): Promise<T>;
export declare function writeJson(file: string, value: unknown): Promise<void>;
export declare function sha256Of(file: string): Promise<string>;
export declare function run(executable: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): Promise<{
    stdout: string;
    stderr: string;
}>;
export declare function walkFiles(root: string, rel?: string): Promise<string[]>;
export declare const rel: (root: string, file: string) => string;
