import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { exists } from "./fs.js";
const extensions = new Set([
    ".java", ".kt", ".kts", ".swift", ".m", ".mm",
    ".dart", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".py", ".go", ".cs", ".fs", ".fsx", ".rs",
    ".c", ".cc", ".cpp", ".cxx", ".h", ".hh", ".hpp",
    ".proto", ".graphql", ".gql", ".sql", ".ddl",
    ".xml", ".yaml", ".yml", ".json", ".toml", ".properties",
]);
const ignored = new Set([
    ".git", "node_modules", "target", "build", "dist", ".idea", ".gradle",
    ".dart_tool", ".swiftpm", "DerivedData", "Pods", "Carthage", "vendor",
    ".venv", "venv", "coverage", "openspec",
]);
// Dependency locks and generated bundles are not source evidence. Excluding
// them prevents a large lock file from downgrading an otherwise complete
// source scan while keeping the exclusion visible in searchCoverage.
const ignoredFiles = new Set([
    "package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock",
    "Podfile.lock", "Cartfile.resolved", "Package.resolved", "pubspec.lock",
    "Cargo.lock", "go.sum",
]);
const conventionFiles = [
    "README.md", "README.MD", "readme.md", "package.json", "pom.xml",
    "build.gradle", "build.gradle.kts", "settings.gradle", "pyproject.toml", "go.mod",
    "Cargo.toml", "Package.swift", "Package.resolved", "Podfile", "pubspec.yaml",
    "CMakeLists.txt", "Makefile",
];
const conventionPattern = /(?:必须|不得|禁止|应当|需要保持|现有行为|兼容|持久化|存储|身份|认证|测试|\bmust\b|\bmust not\b|\brequired\b|\bshall\b|compatib|persist|storage|auth|test)/iu;
const mandatoryPattern = /(?:必须|不得|禁止|应当|需要保持|现有行为[^。\n]{0,20}保持|\bmust\b|\bmust not\b|\brequired\b|\bshall\b)/iu;
async function walkSources(root, relative, scan, limit) {
    const absolute = path.join(root, relative);
    if (!await exists(absolute))
        return;
    let entries;
    try {
        entries = await readdir(absolute, { withFileTypes: true });
    }
    catch {
        scan.unreadableDirectories += 1;
        return;
    }
    for (const entry of entries) {
        if (ignored.has(entry.name) || ignoredFiles.has(entry.name))
            continue;
        if (entry.isSymbolicLink()) {
            scan.skippedSymlinks += 1;
            continue;
        }
        if (scan.files.length >= limit) {
            scan.truncated = true;
            return;
        }
        const child = path.join(relative, entry.name);
        if (entry.isDirectory()) {
            await walkSources(root, child, scan, limit);
            if (scan.truncated)
                return;
            continue;
        }
        if (!entry.isFile() || !extensions.has(path.extname(entry.name).toLowerCase()))
            continue;
        const absoluteFile = path.join(root, child);
        const metadata = await stat(absoluteFile).catch(() => null);
        if (!metadata) {
            scan.unreadableFiles += 1;
            continue;
        }
        if (metadata.size > 160_000) {
            scan.skippedLargeFiles += 1;
            continue;
        }
        scan.files.push(child);
    }
}
async function scanProjectSources(root, limit) {
    const scan = {
        files: [], truncated: false, skippedLargeFiles: 0, unreadableFiles: 0,
        unreadableDirectories: 0, skippedSymlinks: 0,
    };
    await walkSources(root, "", scan, limit);
    return scan;
}
async function names(root) {
    if (!await exists(root))
        return [];
    return (await readdir(root, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}
function openSpecIndexStatement(currentSpecs, priorChanges) {
    const specs = currentSpecs.length ? `为 ${currentSpecs.map((item) => `\`${item}\``).join("、")}` : "为空";
    const changes = priorChanges.length ? `为 ${priorChanges.map((item) => `\`${item}\``).join("、")}` : "为空";
    return `OpenSpec 索引显示：当前正式 specs ${specs}；历史活动 changes ${changes}。`;
}
async function projectConventionEvidence(root) {
    const result = [];
    const seen = new Set();
    for (const candidate of conventionFiles) {
        const file = candidate.replace(/\\/gu, "/");
        if (seen.has(file.toLocaleLowerCase()))
            continue;
        const absolute = path.join(root, candidate);
        if (!await exists(absolute))
            continue;
        const metadata = await stat(absolute).catch(() => null);
        if (!metadata || metadata.size > 160_000)
            continue;
        seen.add(file.toLocaleLowerCase());
        const lines = (await readFile(absolute, "utf8").catch(() => "")).split(/\r?\n/u);
        const selected = lines.map((lineText, index) => ({ text: lineText.trim(), index }))
            .filter(({ text: lineText }) => lineText && conventionPattern.test(lineText)).slice(0, 10);
        const fallback = selected.length ? selected : lines.map((lineText, index) => ({ text: lineText.trim(), index }))
            .filter(({ text: lineText }) => lineText).slice(0, 4);
        if (!fallback.length)
            continue;
        result.push({ file, excerpts: fallback.map(({ text: lineText, index }) => ({
                ref: `code:${file}#L${index + 1}-L${index + 1}`,
                text: `L${index + 1}: ${lineText}`,
                mandatory: mandatoryPattern.test(lineText),
            })) });
    }
    return result;
}
export async function evidenceBundle(projectRoot, workflowId, rawTerms, options = {}) {
    const terms = (Array.isArray(rawTerms) ? rawTerms : [])
        .map(String).map((term) => term.trim()).filter(Boolean).slice(0, 6);
    if (terms.length < 2)
        throw new Error("evidence-bundle 需要 2-6 个稳定业务/代码关键词。");
    const searchTerms = [...new Set(terms.flatMap((term) => {
            const camelParts = term.match(/[A-Z]+(?=[A-Z][a-z]|\b)|[A-Z]?[a-z]+|\d+/gu) ?? [];
            return [term, ...camelParts.filter((part) => part.length >= 4)];
        }).map((term) => term.toLocaleLowerCase()))].slice(0, 18);
    const fileLimit = Math.max(1, Math.min(options.fileLimit ?? 2_000, 10_000));
    const scan = await scanProjectSources(projectRoot, fileLimit);
    const files = scan.files;
    const lowered = searchTerms;
    const seenTerms = new Set();
    const matches = [];
    let scannedTextFiles = 0;
    for (const file of files) {
        const absolute = path.join(projectRoot, file);
        let content;
        try {
            content = await readFile(absolute, "utf8");
        }
        catch {
            scan.unreadableFiles += 1;
            continue;
        }
        scannedTextFiles += 1;
        if (!content)
            continue;
        const contentLower = content.toLocaleLowerCase();
        for (const term of lowered)
            if (contentLower.includes(term))
                seenTerms.add(term);
        const lines = content.split(/\r?\n/u);
        const fileLower = file.toLocaleLowerCase();
        let score = lowered.reduce((sum, term) => sum + (fileLower.includes(term) ? (term.length >= 6 ? 45 : 20) : 0), 0);
        const candidates = [];
        for (let index = 0; index < lines.length; index += 1) {
            const lower = lines[index].toLocaleLowerCase();
            const termHits = lowered.filter((term) => lower.includes(term)).length;
            const codeAnchor = /(?:@(?:get|post|put|delete|request)mapping|\b(?:class|struct|enum|protocol|interface|func|fun|def)\s+|\b(?:public|protected|private|internal|export)\s+|\breturn\s+)/iu.test(lines[index]);
            if (termHits === 0 && !codeAnchor)
                continue;
            const lineScore = termHits * 4 + (codeAnchor ? 5 : 0) - (/^\s*(?:import|using|package)\s/u.test(lines[index]) ? 4 : 0);
            if (lineScore <= 0)
                continue;
            candidates.push({ index, score: lineScore });
            score += termHits;
        }
        const chosen = [];
        for (const candidate of candidates.sort((a, b) => b.score - a.score || a.index - b.index)) {
            if (chosen.length >= 3)
                break;
            if (chosen.some((index) => Math.abs(index - candidate.index) <= 2))
                continue;
            chosen.push(candidate.index);
        }
        const excerpts = chosen.sort((a, b) => a - b).map((index) => {
            const from = Math.max(0, index - 2);
            const to = Math.min(lines.length, index + 3);
            const fileRef = file.replace(/\\/gu, "/");
            return {
                ref: `code:${fileRef}#L${from + 1}-L${to}`,
                text: lines.slice(from, to).map((lineText, offset) => `L${from + offset + 1}: ${lineText.trim()}`).join("\n"),
            };
        });
        if (score > 0)
            matches.push({ file: file.replace(/\\/gu, "/"), score, excerpts });
    }
    matches.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
    const coverageCompleteness = scan.truncated || scan.skippedLargeFiles > 0 || scan.unreadableFiles > 0
        || scan.unreadableDirectories > 0 || scan.skippedSymlinks > 0
        ? "partial"
        : scannedTextFiles > 0 ? "complete" : "unknown";
    const searchCoverage = {
        scope: ["."],
        ignoredDirectories: [...ignored].sort(),
        ignoredFiles: [...ignoredFiles].sort(),
        supportedExtensions: [...extensions].sort(),
        enumeratedFiles: files.length,
        scannedFiles: scannedTextFiles,
        skippedLargeFiles: scan.skippedLargeFiles,
        unreadableFiles: scan.unreadableFiles,
        unreadableDirectories: scan.unreadableDirectories,
        skippedSymlinks: scan.skippedSymlinks,
        fileLimit,
        truncated: scan.truncated,
        completeness: coverageCompleteness,
        definition: "complete 表示在已声明扩展名、忽略目录和大小上限内完成扫描；不表示扫描了二进制、生成物或未知格式。",
    };
    const topLevel = (await readdir(projectRoot, { withFileTypes: true }))
        .map((entry) => entry.name).filter((name) => !ignored.has(name)).sort();
    const currentSpecs = await names(path.join(projectRoot, "openspec", "specs"));
    const priorChanges = (await names(path.join(projectRoot, "openspec", "changes")))
        .filter((name) => name !== "archive" && name !== workflowId);
    const openSpecStatement = openSpecIndexStatement(currentSpecs, priorChanges);
    const conventions = await projectConventionEvidence(projectRoot);
    const mandatoryCompatibilityConstraints = conventions.flatMap(({ excerpts }) => excerpts)
        .filter(({ mandatory }) => mandatory).map(({ mandatory: _mandatory, ...item }) => item);
    const absentTerms = lowered.filter((term) => !seenTerms.has(term));
    const maySignNegativeEvidence = coverageCompleteness === "complete";
    const negativeSearchRef = `search:evidence-bundle:${createHash("sha256")
        .update(`${workflowId}\0${files.length}\0${lowered.join("|")}\0${coverageCompleteness}`)
        .digest("hex").slice(0, 12)}`;
    const negativeSearchStatement = absentTerms.length && maySignNegativeEvidence
        ? `在本次已完成的受支持源码扫描中，${scannedTextFiles} 个文件未命中这些精确代码词：${absentTerms.map((term) => `\`${term}\``).join("、")}。`
        : "";
    const negativeSearchEvidence = negativeSearchStatement ? {
        ref: negativeSearchRef,
        absentTerms,
        coverage: searchCoverage,
        statement: negativeSearchStatement,
        rule: "该引用只证明这些精确代码词在已声明扫描范围内未命中；不得据此声称整个业务能力、模块或其他实体不存在。",
    } : null;
    const negativeSearchGap = absentTerms.length && !maySignNegativeEvidence ? {
        absentTerms,
        coverage: searchCoverage,
        reason: "扫描覆盖不完整或未知，因此运行时拒绝签发不存在性证据。",
        requiredDisposition: "只能登记为 evidence-gap/open-question，availability 必须保持 unknown。",
    } : null;
    const bundle = {
        schemaVersion: "ddd-evidence-bundle/v2",
        terms,
        expandedSearchTerms: searchTerms,
        repositoryShape: topLevel,
        sourceFileCount: scannedTextFiles,
        searchCoverage,
        matches: matches.slice(0, 8).map(({ file, excerpts }) => ({ file, excerpts })),
        projectConventionEvidence: conventions,
        mandatoryCompatibilityConstraints,
        openSpecIndex: {
            currentSpecs,
            priorChanges,
            citation: "search:openspec/specs-and-prior-changes",
            statement: openSpecStatement,
            rule: "该引用只证明列出的 OpenSpec specs/change 索引；claim 必须逐字复制 statement，不得推导业务能力不存在、边界为空白或目标设计待建。",
        },
        negativeSearchEvidence,
        negativeSearchGap,
        citationRule: [
            "事实的 evidence_refs 必须逐字复制 excerpt.ref（code:相对路径#Lx-Ly）；不得只写裸路径。",
            "只有 searchCoverage.completeness=complete 时运行时才会签发 negativeSearchEvidence。",
            "使用负向搜索时 observation.statement 必须逐字复制签发 statement，不得追加能力、模块或实体不存在的推论。",
            "覆盖不完整时只能登记 evidence-gap/open-question，availability 保持 unknown。",
            "使用 OpenSpec 索引时必须提交 current-spec-decision/fact 并逐字复制 openSpecIndex.statement。",
            "mandatoryCompatibilityConstraints 必须逐项写为兼容性约束，后续设计不得降级为实施前可选核验。",
        ].join(""),
        requiredCoverage: ["事实、假设与待确认项", "工程约束与兼容性", "可执行验收约束", "现状代码证据索引", "验证基线", "OpenSpec历史战略基线"],
        responseBudget: { totalSectionChars: "900-1600", observations: "4-6" },
        nextAction: "依据本 bundle 直接调用 complete-stage；不要逐文件补读、不要先输出草稿或推理。",
    };
    const snapshot = {
        repositoryShape: topLevel,
        searchCoverage,
        issuedCodeEvidence: [
            ...conventions.flatMap(({ excerpts }) => excerpts.map(({ ref, text: excerptText }) => ({ ref, text: excerptText }))),
            ...matches.flatMap(({ excerpts }) => excerpts.map(({ ref, text: excerptText }) => ({ ref, text: excerptText }))),
        ],
        codeEvidence: [
            ...mandatoryCompatibilityConstraints,
            ...matches.slice(0, 4).flatMap(({ excerpts }) => excerpts.slice(0, 1)).map(({ ref, text: excerptText }) => ({ ref, text: excerptText })),
        ].slice(0, 8),
        mandatoryCompatibilityConstraints,
        openSpecIndex: bundle.openSpecIndex,
        authorizedSearchEvidence: negativeSearchEvidence
            ? [{ ref: negativeSearchRef, absentTerms, statement: negativeSearchStatement, coverage: searchCoverage }]
            : [],
    };
    const workbench = path.join(projectRoot, "openspec", "changes", workflowId, "ddd", ".ddd", "workbench");
    await mkdir(workbench, { recursive: true });
    await writeFile(path.join(workbench, "evidence-snapshot.json"), `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    return bundle;
}
//# sourceMappingURL=evidence.js.map