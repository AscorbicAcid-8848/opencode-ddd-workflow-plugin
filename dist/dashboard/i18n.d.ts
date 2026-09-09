export type Language = "zh" | "en";
export declare function resolveLanguage(host: unknown, env?: NodeJS.ProcessEnv, fallback?: string): Language;
export declare function translate(language: Language, text: string): string;
