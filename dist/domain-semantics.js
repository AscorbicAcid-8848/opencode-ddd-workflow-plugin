const QUERY_RESULT_SUFFIX = /(?:已查询|查询已完成|已返回|已展示|已读取|已加载)$/u;
const ENGLISH_QUERY_SUBJECT = "(?:Query|Search|Lookup|Read|Fetch|List|Result|View|Details|Summary|Status|Response)";
const ENGLISH_QUERY_RESULT = new RegExp(`\\b[A-Za-z0-9]*${ENGLISH_QUERY_SUBJECT}[A-Za-z0-9]*(?:Returned|Queried|Loaded|Displayed|Retrieved)\\b`, "u");
/**
 * Detect query/read-model outcomes that were incorrectly promoted to domain
 * events. The detector intentionally relies on interaction shape and result
 * suffixes rather than business nouns such as shop, trail, visit, or order.
 */
export function queryPseudoEvents(text) {
    const chinese = /(?:事件|领域事件|\bemits\b)\s*[：:]?\s*([^→\n。；]{0,48}(?:查询|详情|列表|结果|页面|视图|摘要|状态|响应|返回值)[^→\n。；]{0,24}(?:已查询|查询已完成|已返回|已展示|已读取|已加载))/giu;
    const english = new RegExp(`(?:事件|领域事件|\\bemits\\b)\\s*[：:]?\\s*(${ENGLISH_QUERY_RESULT.source})`, "giu");
    const queryChains = text.split(/\r?\n/u).flatMap((line) => {
        if (!/(?:查询|读取|检索|获取|列表|\bquery\b|\bread\b)/iu.test(line) || !/(?:→|->)/u.test(line))
            return [];
        const segments = line.split(/(?:→|->)/u).map((item) => item.trim());
        const queryIndex = segments.findIndex((item) => /(?:查询|读取|检索|获取|\bquery\b|\bread\b)/iu.test(item));
        if (queryIndex < 0)
            return [];
        const candidates = [];
        for (const segment of segments.slice(queryIndex + 1)) {
            if (/(?:[（(]\s*(?:命令|command)\s*[）)]|(?:命令|command)\s*[：:]|\bissues?\s+command\b)/iu.test(segment))
                break;
            const explicitReadModel = /(?:\breturns?\b|读模型|read model|非领域事件)/iu.test(segment);
            const declaredEvent = /(?:🟧|领域事件|\bevent\b|\bemits\b)/iu.test(segment);
            const normalized = segment
                .replace(/^(?:🟧\s*|领域事件\s*[：:]?\s*|事件\s*[：:]?\s*)/iu, "")
                .replace(/\([^)]*\)\s*$/u, "")
                .replace(/[。；;]+$/u, "")
                .trim();
            const resultDisguisedAsFact = QUERY_RESULT_SUFFIX.test(normalized) || ENGLISH_QUERY_RESULT.test(normalized);
            if (!/(?:读模型|read model|非领域事件)/iu.test(segment) && (declaredEvent || resultDisguisedAsFact)) {
                candidates.push(normalized);
            }
            if (explicitReadModel)
                break;
        }
        return candidates;
    });
    const standaloneEnglish = [...text.matchAll(new RegExp(ENGLISH_QUERY_RESULT.source, "gu"))]
        .map((match) => match[0]);
    return [...new Set([
            ...[...text.matchAll(chinese), ...text.matchAll(english)].map((match) => match[1].trim()),
            ...queryChains,
            ...standaloneEnglish,
        ])];
}
/** Generic rule families used only to track explicitly deferred decisions. */
export const BUSINESS_RULE_FAMILIES = [
    {
        family: "authorization",
        label: "身份/权限处理",
        pattern: /(?:未认证|未登录|无权限|权限不足|身份无效)[^。；\n]{0,36}(?:拒绝|忽略|记录|允许|提示|返回)|仅(?:认证|登录|授权|具备权限)的?(?:主体|用户|调用方)/u,
    },
    {
        family: "repeat",
        label: "重复/去重规则",
        pattern: /(?:重复|再次|同一[^。；\n]{0,18}多次)[^。；\n]{0,44}(?:幂等|去重|仅记录|保留首次|逐次保留|允许多次|拒绝)/u,
    },
    {
        family: "retention",
        label: "保留周期",
        pattern: /(?:记录|数据|事实|日志|历史)[^。；\n]{0,36}(?:永久保留|仅保留|保留\d+|TTL|自动过期|归档|删除)/iu,
    },
    {
        family: "compensation",
        label: "撤销/补偿规则",
        pattern: /(?:误操作|错误操作|补偿|撤销|冲正|回退)[^。；\n]{0,40}(?:支持|不支持|申请|允许|拒绝|删除|恢复|重放)/u,
    },
    {
        family: "time-boundary",
        label: "时间边界",
        pattern: /(?:自然日|业务日|时间窗口|日界线|时区)[^。；\n]{0,40}(?:00:00|23:59|系统时区|用户时区|服务器时间|开始|结束|跨日)/u,
    },
    {
        family: "invalid-reference",
        label: "引用对象不存在处理",
        pattern: /(?:对象|资源|实体|标识|ID|编号)[^。；\n]{0,28}(?:不存在|无效|失效)[^。；\n]{0,24}(?:拒绝|报错|提示|忽略|返回)/u,
    },
];
export function deferredRuleFamilies(document) {
    const deferredText = document.split(/\r?\n/u)
        .filter((line) => /(?:待战术事件风暴|未来候选|后续阶段定义)/u.test(line)).join("\n");
    return BUSINESS_RULE_FAMILIES.filter((rule) => rule.pattern.test(deferredText)).map((rule) => rule.family);
}
function sentences(text) {
    return text.split(/(?<=[。！？；])|\r?\n/u).map((item) => item.trim()).filter(Boolean);
}
/** Extract invariant obligations without knowing the domain vocabulary. */
export function requestedInvariantClauses(text, kind) {
    const pattern = kind === "cardinality"
        ? /(?:每次|每一|任一|必须|不得|只能)[^。；\n]{0,100}(?:恰好|至少|至多|最多|唯一|一次|一条|一个)/u
        : /(?:重复|再次|多次|并发)[^。；\n]{0,100}(?:保留|不去重|去重|独立|幂等|拒绝|合并)/u;
    return sentences(text).filter((sentence) => pattern.test(sentence));
}
const STOP_ANCHORS = new Set([
    "必须", "不得", "只能", "每次", "每一", "任一", "恰好", "至少", "至多", "最多",
    "一次", "一条", "一个", "重复", "再次", "多次", "并发", "保留", "独立", "规则",
]);
function semanticAnchors(text) {
    const latin = text.match(/[A-Za-z_][A-Za-z0-9_.-]{2,}/gu) ?? [];
    const cjk = text.match(/[\p{Script=Han}]{2,8}/gu) ?? [];
    return [...new Set([...latin, ...cjk]
            .map((item) => item.trim()).filter((item) => item.length >= 2 && !STOP_ANCHORS.has(item)))];
}
export function invariantCoversClause(domainText, clause) {
    if (!/\bINV-\d+\b/u.test(domainText))
        return false;
    const anchors = semanticAnchors(clause);
    if (!anchors.length)
        return false;
    const required = Math.min(2, anchors.length);
    return anchors.filter((anchor) => domainText.includes(anchor)).length >= required;
}
function cleanConcept(value) {
    return value
        .replace(/^(?:原始)?(?:请求|需求|业务|规则)?(?:明确|要求|说明)?[：:]?/u, "")
        .replace(/^(?:并且|同时|其中|即)/u, "")
        .trim();
}
/** Recover explicit ubiquitous-language distinctions from the original request. */
export function requestedTermDistinctions(text) {
    const result = [];
    for (const sentence of sentences(text)) {
        const match = /([^，。；\n]{2,36}?)(?:不表示|不等于|并非|不是)([^，。；\n]{2,36})/u.exec(sentence);
        if (!match)
            continue;
        const left = cleanConcept(match[1]);
        const right = cleanConcept(match[2].replace(/[。！？；]+$/u, ""));
        if (left.length < 2 || right.length < 2)
            continue;
        result.push({ statement: match[0].replace(/[。！？；]+$/u, "").trim(), left, right });
    }
    return result;
}
export function textCoversDistinction(text, distinction) {
    if (!text.includes(distinction.left) || !text.includes(distinction.right))
        return false;
    const left = distinction.left.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const right = distinction.right.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return new RegExp(`${left}[^。；\\n]{0,48}(?:不表示|不等于|并非|不是)[^。；\\n]{0,48}${right}`, "u").test(text);
}
//# sourceMappingURL=domain-semantics.js.map