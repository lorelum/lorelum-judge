# @lorelum/provider-openai-compatible

Non-streaming OpenAI Chat Completions text transport. It sends a request and
returns text plus whitelisted response facts; it never compiles a rubric,
parses verdict JSON, interprets a review, retries, switches models, or invents
decoding parameters.

It depends on `@lorelum/judge-protocol` and `@lorelum/judge-runtime`; it does
not depend on `@lorelum/judge`.

## Endpoint identity

`describeEndpoint(value)` validates a base URL and returns the normalized URL
and its `sha256:` identity.

- Only trailing slashes used for joining `/chat/completions` are removed.
  Scheme, host, port, and path remain part of the identity.
- User info, query strings, fragments, and whitespace are rejected, so a query
  token cannot enter identity or persistence.
- `createOpenAiCompatibleModel` takes the credential separately as `apiKey`;
  rotating it does not change endpoint or method identity.

## Transport

```ts
const model = createOpenAiCompatibleModel({
  endpoint: "https://api.example/v1",
  apiKey: process.env.MOCK_KEY,
  timeoutMs: 30_000,
});
```

`generate(request)` requires `request.config` with an explicit `model` and may
carry `temperature`, `topP`, `maxTokens`, and `seed`. Only set fields are sent,
mapped to `temperature`, `top_p`, `max_tokens`, and `seed`. Unknown fields,
tool calls, an empty model, or an out-of-range value fail before any HTTP call.

The response returns `kind: "message"` with `content` and optional metadata
(`provider`, `model`, `responseId`, `finishReason`, `status`, `usage`). The
server-declared model is recorded, not treated as proof of remote internals.
HTTP errors, invalid JSON, empty content, timeout, cancellation, and network
failure are distinct `ProviderTransportError` codes. Error messages never
include the response body, headers, credential, or raw endpoint.
