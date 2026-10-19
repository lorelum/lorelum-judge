import { executeReview } from "@lorelum/judge";
import { frozenRubricToDefinition } from "@lorelum/judge-protocol";
import { createOpenAiCompatibleModel, describeEndpoint } from "@lorelum/provider-openai-compatible";

import { assert, evidence, frozenRubric, startMockModel } from "./shared.mjs";

/**
 * Mock LLM example: a real local HTTP Chat Completions request is driven through
 * the provider and Judge's parser. No external model or key is used.
 */
export async function runMockLlmReview() {
  const converted = frozenRubricToDefinition(frozenRubric());
  assert(converted.ok, "frozen rubric conversion failed");
  const mock = await startMockModel();
  try {
    const endpoint = describeEndpoint(mock.url);
    const model = createOpenAiCompatibleModel({ endpoint: mock.url });
    const result = await executeReview(
      {
        definition: converted.value,
        evidence,
        method: {
          kind: "llm",
          provider: {
            protocol: "openai.chat-completions/v1",
            adapterVersion: "1",
          },
          endpointIdentity: endpoint.identity,
          model: { provider: "mock", name: "mock-model" },
          decoding: { temperature: 0, maxTokens: 128, seed: 1 },
        },
      },
      { model },
    );
    assert(result.ok, "mock LLM review returned validation issues");
    assert(mock.requests.length === 1, "the mock model must receive one request");
    assert(
      result.value.execution.attempts[0]?.status === "completed",
      "LLM attempt is not complete",
    );
    assert(
      result.value.execution.attempts[0]?.llm?.response?.model === "mock-model",
      "response metadata was not recorded",
    );
    return result.value;
  } finally {
    await mock.close();
  }
}
