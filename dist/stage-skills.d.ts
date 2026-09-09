import type { StageContract } from "./types.js";
/** Load actual bundled instructions, not just skill names. No model-driven discovery required. */
export declare function loadStageSkills(stage: StageContract, skillsRoot?: string): Promise<{
    name: string;
    source: string;
    sha256: string;
    instructions: string;
}[]>;
