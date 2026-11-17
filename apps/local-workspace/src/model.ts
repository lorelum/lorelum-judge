import {
  type JsonValue,
  type ModelGenerationConfig,
  type ModelPort,
  type ModelRequest,
  validateGenerationConfig,
} from "@lorelum/judge-runtime";
import { createOpenAiCompatibleModel, describeEndpoint } from "@lorelum/provider-openai-compatible";

/** The recipient and fixed generation settings are shown before disclosure approval. */
export function createConfiguredModel(options: {
  readonly endpoint: string;
  readonly apiKey?: string;
  readonly config: ModelGenerationConfig;
}): {
  readonly model: ModelPort;
  readonly recipient: string;
  readonly config: ModelGenerationConfig;
} {
  const endpoint = describeEndpoint(options.endpoint);
  const config = Object.freeze(structuredClone(options.config));
  const validation = validateGenerationConfig(config);
  if (!validation.ok) throw new Error("Invalid model generation configuration");
  const provider = createOpenAiCompatibleModel({
    endpoint: endpoint.url,
    ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
  });
  const model: ModelPort = Object.freeze({
    async generate(request: ModelRequest) {
      if (request.config !== undefined) {
        const requested = validateGenerationConfig(request.config);
        if (
          !requested.ok ||
          requested.value.model !== config.model ||
          requested.value.temperature !== config.temperature ||
          requested.value.topP !== config.topP ||
          requested.value.maxTokens !== config.maxTokens ||
          requested.value.seed !== config.seed
        ) {
          throw new Error(
            "Model request configuration differs from the approved host configuration",
          );
        }
      }
      return provider.generate({ ...request, config });
    },
  });
  return Object.freeze({ model, recipient: endpoint.url, config });
}

/** Deterministic local model: replaces one user-selected text file with user-supplied text. */
export function createOfflineModel(options: {
  readonly targetPath: string;
  readonly replacement: string;
  readonly checkDescription: string;
}): ModelPort {
  const { targetPath, replacement, checkDescription } = options;
  return Object.freeze({
    async generate(request) {
      if (request.signal.aborted) throw new Error("Offline model request cancelled");
      if (request.messages.length === 2 && request.messages[0]?.role === "system") {
        const input = JSON.parse(request.messages[1]?.content ?? "") as {
          id: string;
          revision: number;
          task: { acceptance?: JsonValue[] };
          sources: { id: string; kind: string }[];
          instructions: string;
        };
        const userSource = input.sources.find((source) => source.kind === "user");
        if (!userSource) throw new Error("Offline planning requires a user source");
        const acceptance = input.task.acceptance ?? [
          {
            id: "replace",
            text: `Update ${targetPath} with the supplied text`,
            source: { origin: "user", ref: userSource.id },
          },
        ];
        const acceptanceIds = acceptance.map((item) => {
          if (
            typeof item !== "object" ||
            item === null ||
            !("id" in item) ||
            typeof item.id !== "string"
          )
            throw new Error("Invalid acceptance criterion");
          return item.id;
        });
        return {
          kind: "structured",
          value: {
            schema: "workflow-plan/v1",
            id: input.id,
            revision: input.revision,
            task: { ...input.task, acceptance },
            sources: input.sources,
            goal: `Replace the contents of ${targetPath}`,
            scope: [targetPath],
            steps: [
              {
                id: "replace",
                description: input.instructions || `Update ${targetPath}`,
                acceptanceIds,
              },
            ],
            checks: [{ id: "check", description: checkDescription, acceptanceIds }],
            nonGoals: ["Publish or modify the source workspace"],
            missing: [],
            conflicts: [],
          },
        };
      }
      const input = JSON.parse(request.messages[0]?.content ?? "") as {
        observations: { type: string; path?: string; identity?: string }[];
      };
      const read = input.observations.find(
        (item) => item.type === "read" && item.path === targetPath,
      );
      const written = input.observations.some(
        (item) => item.type === "write" && item.path === targetPath,
      );
      const value = !read
        ? { type: "read", path: targetPath }
        : !written
          ? {
              type: "write",
              path: targetPath,
              expectedIdentity: read.identity ?? null,
              content: replacement,
            }
          : { type: "done" };
      return { kind: "structured", value };
    },
  } satisfies ModelPort);
}
