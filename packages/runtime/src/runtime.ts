import type { RuntimePorts } from "./ports";
import type { ResumeRequest, ResumeResult, RuntimeRequest, RuntimeRun } from "./run";

export interface AgentRuntime {
  run(request: RuntimeRequest, ports: RuntimePorts): Promise<RuntimeRun>;
  resume(request: ResumeRequest, ports: RuntimePorts): Promise<ResumeResult>;
}
