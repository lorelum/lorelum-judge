import { evaluateCode, generateCodeSuggestions } from "@lorelum/judge";
import { createOpenAiCompatibleModel, describeEndpoint } from "@lorelum/provider-openai-compatible";
import { respondToEvaluation } from "./code-evaluation.js";
import { assert, startMockModel } from "./shared.js";

/** Exercise evaluation then suggestions through the real public HTTP model adapter. */
export async function runCodeSuggestions() {
  let evaluation;
  const mock = await startMockModel((body) => {
    if (!evaluation) return respondToEvaluation(body);
    const problem = evaluation.result.problems[0];
    if (!problem) throw new Error("the actual evaluation did not produce a problem");
    return {
      schema: "lorelum.judge.code-suggestion-result/v1",
      suggestions: [
        {
          id: "limit-returned-items",
          problemId: problem.id,
          evidenceIds: problem.evidenceIds,
          location: problem.locations[0],
          category: "required",
          problem: "输入超过 20 条时，函数返回了全部元素。",
          priorityRationale: "这会违反调用方依赖的返回数量约定。",
          direction: "在返回前将结果限制为最多 20 条，保留原有顺序。",
          impact: "调用方将不再收到超出限制的元素；应确认分页需求。",
          checks: ["分别用不足、等于和超过 20 条的输入检查结果数量和顺序。"],
          uncertainPremises: ["假定约定的上限适用于所有调用方。"],
          alternatives: [],
          example: "return items.slice(0, 20);",
        },
      ],
      omissions: [],
    };
  });
  try {
    const model = createOpenAiCompatibleModel({ endpoint: mock.url });
    const method = {
      kind: "llm",
      provider: { protocol: "openai.chat-completions/v1", adapterVersion: "1" },
      endpointIdentity: describeEndpoint(mock.url).identity,
      model: { provider: "local-mock", name: "suggestion-example" },
      decoding: { temperature: 0 },
    };
    const initial = await evaluateCode(
      {
        target: { kind: "snippet", text: "export function list(items) { return items; }\n" },
        requirements: ["最多返回 20 条"],
      },
      { model, method, allowModelDisclosure: true, limits: { maxContextRounds: 0 } },
    );
    assert(
      initial.ok && initial.value.result?.problems.length,
      "evaluation did not produce an actual problem",
    );
    evaluation = initial.value;
    const original = JSON.stringify(evaluation);
    const requestsBefore = mock.requests.length;
    const result = await generateCodeSuggestions(
      { evaluation },
      { model, method, allowModelDisclosure: true },
    );
    assert(result.ok, `suggestion input rejected: ${JSON.stringify(result.issues)}`);
    assert(
      result.value.status === "completed",
      `suggestion did not complete: ${JSON.stringify(result.value)}`,
    );
    assert(
      mock.requests.length === requestsBefore + 1,
      "suggestions did not use exactly one model request",
    );
    assert(JSON.stringify(evaluation) === original, "suggestion generation changed the evaluation");
    console.log(result.text);
    return { status: result.value.status, evaluationUnchanged: true, suggestionModelRequests: 1 };
  } finally {
    await mock.close();
  }
}
