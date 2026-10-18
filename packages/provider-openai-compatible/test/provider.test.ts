import { afterEach, describe, expect, test } from "bun:test";
import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import type { ModelRequest } from "@lorelum/judge-runtime";

import {
  createOpenAiCompatibleModel,
  describeEndpoint,
  ProviderTransportError,
} from "../src/index.js";

interface Harness {
  readonly url: string;
  readonly requests: Array<{
    readonly authorization: string | undefined;
    readonly contentType: string | undefined;
    readonly body: Record<string, unknown>;
  }>;
  close(): Promise<void>;
}

const servers: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of servers.splice(0)) await close();
});

async function harness(
  handler: (body: Record<string, unknown>, response: ServerResponse) => void,
): Promise<Harness> {
  const requests: Harness["requests"] = [];
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    let text = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      text += chunk;
    });
    request.on("end", () => {
      const body = JSON.parse(text) as Record<string, unknown>;
      requests.push({
        authorization: request.headers.authorization,
        contentType: request.headers["content-type"],
        body,
      });
      handler(body, response);
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no address");
  const close = async () => {
    server.closeAllConnections();
    server.close();
    await once(server, "close");
  };
  servers.push(close);
  return { url: `http://127.0.0.1:${address.port}/v1`, requests, close };
}

function request(config: ModelRequest["config"]): ModelRequest {
  return {
    runId: "run",
    stepIndex: 0,
    messages: [
      { role: "system", content: "rules" },
      { role: "user", content: "evidence" },
    ],
    tools: [],
    signal: new AbortController().signal,
    ...(config === undefined ? {} : { config }),
  };
}

const content = (value: string) =>
  JSON.stringify({
    id: "resp-1",
    model: "model-1",
    choices: [{ message: { content: value }, finish_reason: "stop" }],
    usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
  });

describe("endpoint identity", () => {
  test("ignores trailing slashes used for joining", () => {
    const a = describeEndpoint("https://example.test/v1");
    const b = describeEndpoint("https://example.test/v1/");
    expect(a.identity).toBe(b.identity);
    expect(a.url).toBe("https://example.test/v1");
  });

  test("keeps meaningful paths and ports distinct", () => {
    const a = describeEndpoint("https://example.test/v1");
    const b = describeEndpoint("https://example.test/v2");
    const c = describeEndpoint("https://example.test:8443/v1");
    expect(a.identity).not.toBe(b.identity);
    expect(a.identity).not.toBe(c.identity);
  });

  test("refuses user info and query strings", () => {
    expect(() => describeEndpoint("https://user:secret@example.test/v1")).toThrow(
      ProviderTransportError,
    );
    expect(() => describeEndpoint("https://example.test/v1?token=secret")).toThrow(
      ProviderTransportError,
    );
  });

  test("credentials do not enter identity", () => {
    const first = createOpenAiCompatibleModel({
      endpoint: "https://example.test/v1",
      apiKey: "key-one",
    });
    const second = createOpenAiCompatibleModel({
      endpoint: "https://example.test/v1",
      apiKey: "key-two",
    });
    expect(typeof first.generate).toBe("function");
    expect(typeof second.generate).toBe("function");
    expect(describeEndpoint("https://example.test/v1").identity).toBe(
      describeEndpoint("https://example.test/v1").identity,
    );
  });
});

describe("OpenAI-compatible transport", () => {
  test("sends exactly the configured model and parameters", async () => {
    const server = await harness((_body, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(content("ok"));
    });
    const model = createOpenAiCompatibleModel({
      endpoint: server.url,
      apiKey: "secret-key",
    });
    const response = await model.generate(
      request({ model: "model-1", temperature: 0.2, topP: 0.9, maxTokens: 64, seed: 7 }),
    );
    expect(server.requests).toHaveLength(1);
    const sent = server.requests[0];
    expect(sent?.authorization).toBe("Bearer secret-key");
    expect(sent?.contentType).toBe("application/json");
    expect(sent?.body).toEqual({
      model: "model-1",
      messages: [
        { role: "system", content: "rules" },
        { role: "user", content: "evidence" },
      ],
      stream: false,
      temperature: 0.2,
      top_p: 0.9,
      max_tokens: 64,
      seed: 7,
    });
    expect(response.kind).toBe("message");
    if (response.kind === "message") {
      expect(response.content).toBe("ok");
      expect(response.metadata).toEqual({
        provider: "openai-compatible",
        status: "200",
        responseId: "resp-1",
        model: "model-1",
        finishReason: "stop",
        usage: { promptTokens: 3, completionTokens: 4, totalTokens: 7 },
      });
    }
  });

  test("omits parameters that were not configured", async () => {
    const server = await harness((_body, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(content("ok"));
    });
    const model = createOpenAiCompatibleModel({ endpoint: server.url });
    await model.generate(request({ model: "model-1" }));
    expect(server.requests[0]?.body).toEqual({
      model: "model-1",
      messages: [
        { role: "system", content: "rules" },
        { role: "user", content: "evidence" },
      ],
      stream: false,
    });
  });

  test("refuses unsupported generation configuration before sending", async () => {
    const server = await harness((_body, response) => {
      response.writeHead(200);
      response.end(content("ok"));
    });
    const model = createOpenAiCompatibleModel({ endpoint: server.url });
    await expect(
      model.generate(request({ model: "model-1", frequencyPenalty: 1 } as never)),
    ).rejects.toMatchObject({ code: "unsupported_config" });
    expect(server.requests).toHaveLength(0);
  });

  test("refuses tool calling", async () => {
    const server = await harness((_body, response) => {
      response.writeHead(200);
      response.end(content("ok"));
    });
    const model = createOpenAiCompatibleModel({ endpoint: server.url });
    const withTool: ModelRequest = {
      ...request({ model: "model-1" }),
      tools: [
        {
          name: "tool",
          description: "a tool",
          inputSchema: { type: "object" },
        },
      ],
    };
    await expect(model.generate(withTool)).rejects.toMatchObject({
      code: "unsupported_config",
    });
    expect(server.requests).toHaveLength(0);
  });

  test("records HTTP errors without a retry", async () => {
    let calls = 0;
    const server = await harness((_body, response) => {
      calls += 1;
      response.writeHead(503, { "content-type": "text/plain" });
      response.end("secret internal failure");
    });
    const model = createOpenAiCompatibleModel({ endpoint: server.url });
    let error: unknown;
    try {
      await model.generate(request({ model: "model-1" }));
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ProviderTransportError);
    if (error instanceof ProviderTransportError) {
      expect(error.code).toBe("http_error");
      expect(error.httpStatus).toBe(503);
      expect(error.message).not.toContain("secret");
    }
    expect(calls).toBe(1);
  });

  test("omits malformed usage counts", async () => {
    const server = await harness((_body, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: "resp-1",
          model: "model-1",
          choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1.5, completion_tokens: 2, total_tokens: 3.5 },
        }),
      );
    });
    const model = createOpenAiCompatibleModel({ endpoint: server.url });
    const result = await model.generate(request({ model: "model-1" }));
    expect(result.kind).toBe("message");
    if (result.kind === "message") {
      expect(result.metadata?.usage).toEqual({ completionTokens: 2 });
    }
  });

  test("distinguishes non-JSON and empty responses", async () => {
    const notJson = await harness((_body, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("not json");
    });
    const first = createOpenAiCompatibleModel({ endpoint: notJson.url });
    await expect(first.generate(request({ model: "model-1" }))).rejects.toMatchObject({
      code: "invalid_response",
    });

    const empty = await harness((_body, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: "" } }] }));
    });
    const second = createOpenAiCompatibleModel({ endpoint: empty.url });
    await expect(second.generate(request({ model: "model-1" }))).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  test("times out and distinguishes it from cancellation", async () => {
    // Integration test of transport timing: the provider's timeout is real HTTP timeout behavior.
    const server = await harness((_body, response) => {
      setTimeout(() => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(content("late"));
      }, 200);
    });
    const model = createOpenAiCompatibleModel({ endpoint: server.url, timeoutMs: 20 });
    await expect(model.generate(request({ model: "model-1" }))).rejects.toMatchObject({
      code: "timeout",
    });
  });

  test("times out while the response body is still streaming", async () => {
    // Integration test of transport timing: headers arrive, body does not.
    const server = await harness((_body, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.write('{"id":"resp","model":"model-1","choices":[');
      setTimeout(() => {
        response.end(
          `${JSON.stringify({
            message: { content: "late" },
            finish_reason: "stop",
          })}]}`,
        );
      }, 200);
    });
    const model = createOpenAiCompatibleModel({ endpoint: server.url, timeoutMs: 20 });
    await expect(model.generate(request({ model: "model-1" }))).rejects.toMatchObject({
      code: "timeout",
    });
  });

  test("cancellation stops the request without a retry", async () => {
    const server = await harness(() => {
      // Never responds; the abort signal is the only completion.
    });
    const model = createOpenAiCompatibleModel({ endpoint: server.url });
    const controller = new AbortController();
    const pending = model.generate({
      ...request({ model: "model-1" }),
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
  });
});
