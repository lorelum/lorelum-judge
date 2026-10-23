import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateCode } from "@lorelum/judge";
import { codeEvaluationReportIdentity } from "@lorelum/judge-protocol";
import { createOpenAiCompatibleModel, describeEndpoint } from "@lorelum/provider-openai-compatible";
import { exampleGitHubSource } from "./github-evaluation-source.js";
import { assert, startMockModel } from "./shared.js";

/** A deliberately narrow deterministic evaluator, not a claim about real model quality. */
function respondToEvaluation(body) {
  const system = body.messages.find((message) => message.role === "system")?.content ?? "";
  const user = body.messages.find((message) => message.role === "user")?.content ?? "";
  const materials = [
    ...user.matchAll(/<evidence id="([^"]+)"[^>]*>\n([\s\S]*?)\n<\/evidence>/g),
  ].map((match) => ({ id: match[1], text: match[2] }));
  if (system.includes("You prepare a read-only code evaluation")) {
    const inventoryMarker = "Source inventory (untrusted data):\n";
    const inventoryText = user.slice(user.indexOf(inventoryMarker) + inventoryMarker.length);
    const inventory = JSON.parse(inventoryText.slice(0, inventoryText.indexOf("\n\n")));
    const requirements = inventory.items
      .filter(
        (item) =>
          item.role === "requirement" &&
          materials.some(
            (material) =>
              material.id === item.id &&
              material.text.includes("At most 20 items must be returned."),
          ),
      )
      .map((item) => ({ text: "At most 20 items must be returned.", source: item.id }));
    return {
      task: user.includes("概览这个模块") ? "overview" : "inspect",
      focus: [],
      standards: ["behavior"],
      requirements,
      excluded: ["boundaries", "security", "concurrency", "performance", "maintenance"].map(
        (id) => ({ id, reason: "本示例只核对明确的返回条数约定，其余维度未系统检查。" }),
      ),
      reads:
        user.includes("读取调用约定") && !inventory.items.some((item) => item.role === "context")
          ? [{ session: 0, request: { kind: "read", path: "contract.txt" } }]
          : [],
    };
  }
  const marker = "Untrusted review context:\n";
  const context = JSON.parse(user.slice(user.lastIndexOf(marker) + marker.length));
  const source =
    context.sources.find(
      (item) =>
        item.role === "target" &&
        item.side !== "old" &&
        materials.some(
          (material) => material.id === item.id && /return items\s*;/.test(material.text),
        ),
    ) ?? context.sources.find((item) => item.role === "target" && item.side !== "old");
  if (!source) throw new Error("example did not receive actual target material");
  const visible = materials.find((material) => material.id === source.id)?.text ?? "";
  const broken = /return items\s*;/.test(visible);
  const problemLine = Number(/^(\d+):.*return items\s*;/m.exec(visible)?.[1] ?? source.startLine);
  const criteria = [...user.matchAll(/^Criterion ([^ ]+) \((quality|contract),/gm)].map(
    (match) => ({ id: match[1], kind: match[2] }),
  );
  const owner = criteria.find((criterion) => criterion.kind === "contract") ?? criteria[0];
  if (!owner) throw new Error("example received no actual criteria");
  const old = context.sources.find(
    (item) => item.role === "target" && item.side === "old" && item.path === source.path,
  );
  const evidenceIds = old && source.side === "new" ? [old.id, source.id] : [source.id];
  const problems = broken
    ? [
        {
          id: "return-limit",
          criterionId: owner.id,
          title: "返回全部元素，未维持条数限制",
          severity: "medium",
          condition: "输入数组超过约定条数",
          impact: "调用方得到超过约定数量的结果",
          rationale: "当前实现直接返回 items，没有应用约定的 20 条上限。",
          evidenceIds,
          locations: [{ itemId: source.id, startLine: problemLine, endLine: problemLine }],
          attribution: old && source.side === "new" ? "introduced" : "not_applicable",
        },
      ]
    : [];
  const result = {
    schema: "lorelum.judge.review-result/v2",
    verdicts: criteria.map((criterion) => ({
      schema: "lorelum.judge.verdict/v1",
      criterionId: criterion.id,
      verdict:
        criterion.kind === "contract" ? (broken ? "unmet" : "met") : broken ? "weak" : "strong",
      evidenceIds: [source.id],
      rationale: broken ? "直接返回数组不满足条数约定。" : "本示例限定的可见行为未见该问题。",
    })),
    summary: [
      {
        text: broken
          ? "提供的实现直接返回所有元素，无法维持明确的结果条数限制。"
          : "在本示例限定的检查范围内，未观察到原先的条数问题。",
        criterionIds: [owner.id],
        problemIds: problems.map((problem) => problem.id),
        evidenceIds: [source.id],
      },
    ],
    problems,
    pending: [],
    followUps: context.followUpReferences.map((reference, index) => ({
      id: `follow-${index}`,
      reference,
      outcome:
        context.task === "recheck"
          ? broken
            ? "persists"
            : "resolved"
          : broken
            ? "supported"
            : "unsupported",
      rationale: broken
        ? "当前可见实现仍直接返回整个数组。"
        : "当前实现包含条数截取，原意见在本次限定路径不成立。",
      evidenceIds: [source.id],
    })),
  };
  if (context.request.includes("仅返回逐项判断")) {
    result.verdicts.reverse();
    result.summary = [];
    result.problems = [];
  }
  if (context.request.includes("保留未知判断")) {
    result.verdicts = result.verdicts.map((verdict) => ({
      ...verdict,
      verdict: "unknown",
      evidenceIds: [],
      rationale: "仍需取得实际调用方的前提。",
    }));
    result.summary = [];
    result.problems = [];
    result.pending = [];
    result.followUps = [];
  }
  return result;
}

export async function runCodeEvaluation() {
  const mock = await startMockModel(respondToEvaluation);
  const endpoint = describeEndpoint(mock.url);
  const model = createOpenAiCompatibleModel({ endpoint: mock.url });
  const ports = {
    model,
    method: {
      kind: "llm",
      provider: { protocol: "openai.chat-completions/v1", adapterVersion: "1" },
      endpointIdentity: endpoint.identity,
      model: { provider: "local-mock", name: "evaluation-example" },
      decoding: { temperature: 0 },
    },
    allowModelDisclosure: true,
    limits: { maxContextRounds: 0 },
  };
  const root = await mkdtemp(join(tmpdir(), "lorelum-evaluation-"));
  const broken = "export function list(items) { return items; }\n";
  const fixed = "export function list(items) { return items.slice(0, 20); }\n";
  const cases = [];
  const evaluate = async (label, input, overrides = {}) => {
    const result = await evaluateCode(input, { ...ports, ...overrides });
    assert(result.ok, `${label}: ${JSON.stringify(result.issues)}`);
    assert(
      result.value.status === "completed" || result.value.status === "partial",
      `${label}: ${JSON.stringify(result.value.issues)}`,
    );
    assert(
      result.value.execution?.attempts[0]?.status === "completed",
      `${label}: ${JSON.stringify(result.value.execution)}`,
    );
    cases.push({ label, report: result.value });
    return result;
  };
  try {
    const initial = await evaluate("snippet", {
      target: { kind: "snippet", text: broken },
      requirements: ["最多返回 20 条"],
    });
    assert(
      initial.value.result.problems[0]?.id === "return-limit",
      "snippet did not report the behavioral defect",
    );
    const verdictOnly = await evaluate("verdict-only-reversed-newlines", {
      target: { kind: "snippet", text: broken },
      request: "仅返回逐项判断，核对返回条数约定。",
      requirements: ["最多返回 20 条\r\n"],
      opinions: [{ id: "limit", text: "当前实现没有限制返回条数\r\n" }],
    });
    assert(verdictOnly.value.status === "completed", "legal verdict-only output did not complete");
    assert(
      verdictOnly.value.result.problems.length === 0 &&
        verdictOnly.value.result.summary.length === 0,
      "fixture unexpectedly supplied detailed findings",
    );
    assert(
      verdictOnly.value.result.verdicts.some((verdict) => verdict.verdict === "weak") &&
        verdictOnly.value.result.verdicts.some((verdict) => verdict.verdict === "unmet"),
      "negative judgments were lost",
    );
    const uncertain = await evaluate("unknown-report-completion", {
      target: { kind: "snippet", text: fixed },
      request: "保留未知判断，不把未知包装成已完成。",
    });
    assert(
      uncertain.value.status === "partial",
      "unknown judgment was promoted to complete coverage",
    );
    const promoted = structuredClone(uncertain.value);
    promoted.status = "completed";
    assert(
      !codeEvaluationReportIdentity(promoted).ok,
      "public record validation accepted a forged completed report",
    );
    await evaluate("files", {
      target: { kind: "files", files: [{ path: "list.js", text: broken }] },
      requirements: ["最多返回 20 条"],
    });
    await evaluate("diff", {
      target: {
        kind: "diff",
        text: "--- a/list.js\n+++ b/list.js\n@@ -1 +1 @@\n-export function list(items) { return items.slice(0, 20); }\n+export function list(items) { return items; }\n",
      },
    });
    await evaluate("comparison", {
      target: {
        kind: "comparison",
        old: [{ path: "list.js", text: fixed }],
        new: [{ path: "list.js", text: broken }],
      },
      requirements: ["最多返回 20 条"],
    });
    const opinion = await evaluate("verify", {
      target: { kind: "snippet", text: broken },
      opinions: [{ id: "limit", text: "返回结果没有维持 20 条限制" }],
    });
    assert(
      opinion.value.result.followUps[0]?.outcome === "supported",
      "opinion was not actually verified",
    );
    const rechecked = await evaluate("recheck", {
      target: { kind: "snippet", text: fixed },
      previousReport: initial.value,
    });
    assert(
      rechecked.value.result.followUps[0]?.outcome === "resolved",
      "old problem was not reassessed against new code",
    );
    assert(
      rechecked.value.previousReportIdentity !== undefined,
      "reassessment lost original report identity",
    );
    const github = exampleGitHubSource(fixed, broken);
    const githubPorts = { sources: { github: github.options } };
    for (const [label, suffix] of [
      ["github-file", "blob/main/src/list.js"],
      ["github-directory", "tree/main/src"],
      ["github-repository", ""],
      ["github-commit", `commit/${github.head}`],
      ["github-compare", `compare/${github.base}...${github.head}`],
      ["github-pr", "pull/7"],
    ]) {
      const evaluated = await evaluate(
        label,
        { target: `https://github.com/example/project${suffix ? `/${suffix}` : ""}` },
        githubPorts,
      );
      assert(
        evaluated.value.source.items.some((item) => item.provenance === "github"),
        `${label}: no actual GitHub content`,
      );
    }
    const requirement = await evaluate(
      "github-requirement",
      {
        target: { kind: "snippet", text: broken },
        requirementSources: ["https://github.com/example/project/issues/8"],
      },
      githubPorts,
    );
    assert(
      requirement.value.plan.requirements.some(
        (entry) => entry.text === "At most 20 items must be returned.",
      ),
      "GitHub requirement was not evaluated",
    );
    const file = join(root, "list.js");
    await writeFile(file, fixed);
    const local = { ...ports.sources, roots: [root] };
    await evaluate("local-file", { target: { kind: "local", path: file } }, { sources: local });
    await writeFile(join(root, "contract.txt"), "At most 20 items must be returned.\n");
    const contextual = await evaluate(
      "bounded-context",
      {
        target: { kind: "local", path: file },
        request: "读取调用约定后检查实现",
        requirements: ["最多返回 20 条"],
      },
      { sources: local, limits: { maxContextRounds: 1 } },
    );
    const acquired = contextual.value.source.items.find(
      (item) => item.role === "context" && item.path.endsWith("contract.txt"),
    );
    assert(
      acquired?.text === "At most 20 items must be returned.\n",
      "bounded context did not read the authorized file",
    );
    assert(
      contextual.value.execution.attempts[0].evidenceBundle.items.some(
        (item) => item.id === acquired.id && item.render?.state === "rendered",
      ),
      "acquired context was not projected into final evaluation",
    );
    await evaluate(
      "module-overview",
      { target: { kind: "local", path: root }, request: "概览这个模块；只检查可见行为" },
      { sources: local },
    );
    const git = (...args) =>
      execFileSync("git", ["--no-pager", ...args], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
      }).trim();
    git("init", "-q");
    git("add", "list.js");
    git(
      "-c",
      "user.name=Offline example",
      "-c",
      "user.email=example@example.invalid",
      "-c",
      "core.hooksPath=",
      "commit",
      "--no-verify",
      "-qm",
      "before",
    );
    const base = git("rev-parse", "HEAD");
    await writeFile(file, broken);
    git("add", "list.js");
    await evaluate(
      "git-staged",
      {
        target: { kind: "git", path: root, selection: "staged" },
        requirements: ["最多返回 20 条"],
      },
      { sources: local },
    );
    await writeFile(file, `${broken}// uncommitted context\n`);
    const before = await readFile(file, "utf8");
    await evaluate(
      "git-unstaged",
      { target: { kind: "git", path: root, selection: "unstaged" } },
      { sources: local },
    );
    assert((await readFile(file, "utf8")) === before, "evaluation changed target worktree");
    await writeFile(join(root, "new.js"), broken);
    await evaluate(
      "git-untracked",
      { target: { kind: "git", path: root, selection: "untracked", paths: ["new.js"] } },
      { sources: local },
    );
    git(
      "-c",
      "user.name=Offline example",
      "-c",
      "user.email=example@example.invalid",
      "-c",
      "core.hooksPath=",
      "commit",
      "--no-verify",
      "-qm",
      "after",
    );
    const head = git("rev-parse", "HEAD");
    for (const selection of ["commit", "compare", "branch", "working"]) {
      await evaluate(
        `git-${selection}`,
        {
          target: { kind: "git", path: root, selection, base, head },
          requirements: ["最多返回 20 条"],
        },
        { sources: local },
      );
    }
    console.log(initial.text);
    console.log(verdictOnly.text);
    console.log(uncertain.text);
    return {
      cases: cases.map(({ label, report }) => ({
        label,
        status: report.status,
        problems: report.result.problems.length,
        identity: codeEvaluationReportIdentity(report).ok,
      })),
      modelRequests: mock.requests.length,
    };
  } finally {
    await mock.close();
    await rm(root, { recursive: true, force: true });
  }
}
