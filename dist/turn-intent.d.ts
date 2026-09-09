export declare const turnIntents: Map<string, "read-only" | "execute">;
/** Conservative turn-local intent. Unknown discussion is not execution permission. */
export declare function classifyTurn(text: string): "read-only" | "execute";
