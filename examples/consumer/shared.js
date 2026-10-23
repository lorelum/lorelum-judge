import { once } from "node:events";
import { createServer } from "node:http";

import { instrumentIdentityV2, measurementDefinitionIdentityV2 } from "@lorelum/judge-protocol";

export const evidence = [
  { id: "e1", status: "present", text: "export function add(a, b) { return a + b; }" },
];

export function frozenRubric() {
  return {
    schema: "lorelum.judge.rubric-set/v1",
    id: "demo-rubric",
    status: "frozen",
    contractIdentity: `sha256:${"e".repeat(64)}`,
    entries: [
      {
        criterion: {
          schema: "lorelum.judge.criterion/v1",
          id: "c1",
          kind: "contract",
          description: "The change adds a working add function",
          mandatory: true,
          source: { origin: "contract", ref: "AC-1" },
          anchors: [
            { verdict: "met", description: "add returns the sum" },
            { verdict: "unmet", description: "add is missing or wrong" },
          ],
          evidence: [{ evidenceId: "e1", role: "primary" }],
        },
        covers: ["AC-1"],
        appliesTo: ["code"],
        role: "decisive",
      },
    ],
  };
}

export function metVerdict() {
  return {
    schema: "lorelum.judge.verdict/v1",
    criterionId: "c1",
    verdict: "met",
    evidenceIds: ["e1"],
    rationale: "The evidence shows the function returns the sum.",
  };
}

export function policyFor(definition, instrument) {
  const definitionId = measurementDefinitionIdentityV2(definition);
  const instrumentId = instrumentIdentityV2(instrument);
  if (!definitionId.ok || !instrumentId.ok) {
    throw new Error("demo identity failed");
  }
  return {
    schema: "lorelum.judge.gate-policy/v2",
    id: "demo-policy",
    definitionIdentity: definitionId.identity,
    instrumentIdentity: instrumentId.identity,
    scopes: [
      {
        taskClass: "code",
        evidenceShape: "code",
        criterionIds: definition.criteria.map((criterion) => criterion.id),
      },
    ],
    criteria: definition.criteria.map((criterion) => ({
      criterionId: criterion.id,
      acceptedVerdicts: ["met"],
      requiredCaseKinds: ["decisive", "equivalent", "anti"],
    })),
    minimumAgreement: 1,
    minimumGroupsPerCaseKind: 1,
    confidenceLevel: 0.95,
    maximumFalseAcceptRate: 0.05,
    maximumFalseRejectRate: 0.1,
    maximumAbstentionRate: 0.2,
    maximumDisagreementRate: 0.2,
    onUncalibrated: "diagnostic",
  };
}

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * Starts a local Chat Completions mock. The example never uses an external
 * service or a real credential.
 */
export async function startMockModel(respond) {
  const requests = [];
  const server = createServer((request, response) => {
    let text = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      text += chunk;
    });
    request.on("end", () => {
      const body = JSON.parse(text);
      requests.push(body);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: "mock-response",
          model: body.model,
          choices: [
            {
              message: {
                content: JSON.stringify(respond ? respond(body) : { verdicts: [metVerdict()] }),
              },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        }),
      );
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("mock model has no port");
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    requests,
    async close() {
      server.closeAllConnections();
      server.close();
      await once(server, "close");
    },
  };
}
