import type { ModelPort, ModelRequest, ModelResponse } from "@lorelum/judge-runtime";

export interface ScriptedModel extends ModelPort {
  readonly requests: readonly ModelRequest[];
}

export class ScriptedModelAdapter implements ScriptedModel {
  readonly requests: ModelRequest[] = [];
  private readonly responses: Array<ModelResponse | Error>;

  constructor(responses: readonly (ModelResponse | Error)[]) {
    this.responses = [...responses];
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (response === undefined) {
      throw new Error("Scripted model has no response left.");
    }
    if (response instanceof Error) {
      throw response;
    }
    return response;
  }
}

export function createScriptedModel(responses: readonly (ModelResponse | Error)[]): ScriptedModel {
  return new ScriptedModelAdapter(responses);
}
