/**
 * Detect query/read-model outcomes that were incorrectly promoted to domain
 * events. The detector intentionally relies on interaction shape and result
 * suffixes rather than business nouns such as shop, trail, visit, or order.
 */
export declare function queryPseudoEvents(text: string): string[];
export interface BusinessRuleFamily {
    family: string;
    label: string;
    pattern: RegExp;
}
/** Generic rule families used only to track explicitly deferred decisions. */
export declare const BUSINESS_RULE_FAMILIES: BusinessRuleFamily[];
export declare function deferredRuleFamilies(document: string): string[];
export type InvariantClauseKind = "cardinality" | "repeat";
/** Extract invariant obligations without knowing the domain vocabulary. */
export declare function requestedInvariantClauses(text: string, kind: InvariantClauseKind): string[];
export declare function invariantCoversClause(domainText: string, clause: string): boolean;
export interface TermDistinction {
    statement: string;
    left: string;
    right: string;
}
/** Recover explicit ubiquitous-language distinctions from the original request. */
export declare function requestedTermDistinctions(text: string): TermDistinction[];
export declare function textCoversDistinction(text: string, distinction: TermDistinction): boolean;
