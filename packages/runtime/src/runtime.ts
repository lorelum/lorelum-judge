import type { RuntimePorts } from "./ports.js";
import type { ResumeRequest, ResumeResult, RuntimeRequest, RuntimeRun } from "./run.js";

export interface AgentRuntime {
  run(request: RuntimeRequest, ports: RuntimePorts): Promise<RuntimeRun>;
  resume(request: ResumeRequest, ports: RuntimePorts): Promise<ResumeResult>;
}
