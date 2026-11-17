import { Button } from "@lorelum/lumen-ui/components/button";
import { Card } from "@lorelum/lumen-ui/components/card";
import { Input } from "@lorelum/lumen-ui/components/input";
import { Textarea } from "@lorelum/lumen-ui/components/textarea";
import { Message } from "@lorelum/lumen-ui/pro/message";
import { PromptInput } from "@lorelum/lumen-ui/pro/prompt-input";
import { LumenProvider } from "@lorelum/lumen-ui/themes";
import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

type Candidate = {
  path: string;
  origin: string;
  status: string;
  exclusionReason: string | null;
  mode: number | null;
  size: number | null;
};
type Plan = {
  identity: string;
  revision: number;
  status: string;
  eligible: boolean;
  acceptanceProposed: boolean;
  plan: {
    goal: string;
    scope: string[];
    task: { acceptance: { id: string; text: string; source: { origin: string; ref: string } }[] };
    steps: { id: string; description: string; acceptanceIds: string[] }[];
    checks: { id: string; description: string; acceptanceIds: string[] }[];
    nonGoals: string[];
    missing: string[];
    conflicts: { description: string; sourceIds: string[] }[];
  };
};
type ChatMessage = { role: "user" | "assistant"; content: string };
type AnalysisResult = {
  status: "idle" | "running" | "completed" | "partial" | "failed" | "cancelled";
  report: unknown | null;
  text: string | null;
  issues: unknown | null;
};
type WorkspaceState = {
  sessionId: string;
  sequence: number;
  workspace: {
    root: string;
    identity: string;
    gitIdentity: string;
    candidates: Candidate[];
  } | null;
  diagnostics: unknown;
  model: { mode: string; recipient: string; config: unknown } | null;
  evaluation: AnalysisResult;
  suggestions: AnalysisResult;
  plan: Plan | null;
  disclosure: {
    identity: string;
    recipient: string;
    mode: string;
    request: unknown;
    authorized: boolean;
  } | null;
  chatDisclosure: {
    identity: string;
    recipient: string;
    mode: string;
    request: { messages: ChatMessage[]; config: unknown };
    authorized: boolean;
  } | null;
  executionDisclosure: {
    identity: string;
    recipient: string;
    request: { messages: unknown; config: unknown };
  } | null;
  chat: { messages: ChatMessage[]; status: string } | null;
  execution: {
    status: string;
    proposal: {
      identity: string;
      permission: {
        readPaths: string[];
        commandReadPaths: string[];
        writePaths: string[];
        writablePaths: string[];
        commands: { executable: string; args: string[]; cwd: string }[];
        disclosures: string[];
        modelRecipient: string;
        limits: unknown;
        expiresAt: number;
      };
    } | null;
    verification: unknown;
    result: {
      status: string;
      reason: string | null;
      workspaceRoot: string | null;
      evidence: {
        candidateIdentity: string;
        checks: { id: string; status: string }[];
        review: unknown;
        reviewStatus: string;
        stopReason: string | null;
        completeness: string;
      } | null;
      report: { diff: string | null; diffUnavailable: string | null; quality: string } | null;
    } | null;
    diffAvailable: boolean;
    diffRevealed: boolean;
    actions: unknown[];
  };
};
type ActionResult = { ok: boolean; state: WorkspaceState; error?: { message: string } };
type WorkflowEvent = {
  sequence: number;
  stage: string;
  status: string;
  actionKind: string | null;
  reason: string | null;
};
const clientHeader = { "X-Local-Workspace": "1" };
const lines = (value: string): string[] =>
  value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
const pretty = (value: unknown): string => JSON.stringify(value, null, 2) ?? "未知";

function DisclosureView({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span>无</span>;
  if (Array.isArray(value)) {
    return value.length ? (
      <ul>
        {value.map((item, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: Values have no local state.
          <li key={index}>
            <DisclosureView value={item} />
          </li>
        ))}
      </ul>
    ) : (
      <span>无</span>
    );
  }
  if (typeof value === "object") {
    return (
      <dl className="data-view">
        {Object.entries(value).map(([key, item]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>
              <DisclosureView value={item} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return <span className="data-value">{String(value)}</span>;
}

function App() {
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState<WorkflowEvent[]>([]);
  const [stream, setStream] = useState("未连接");
  const [root, setRoot] = useState("");
  const [excluded, setExcluded] = useState("");
  const [task, setTask] = useState("");
  const [feature, setFeature] = useState<"evaluation" | "suggestions" | "planning">("evaluation");
  const [conversationInput, setConversationInput] = useState("");
  const [explicitSnippet, setExplicitSnippet] = useState(false);
  const [conversation, setConversation] = useState<(ChatMessage & { label?: string })[]>([]);
  const messagesRef = useRef<HTMLDivElement>(null);
  const [trackedAnalysis, setTrackedAnalysis] = useState<"evaluation" | "suggestions" | null>(null);
  const [trackingPlan, setTrackingPlan] = useState(false);
  const seenPlan = useRef("");
  const seenDisclosure = useRef("");
  const [analysisBusy, setAnalysisBusy] = useState<"evaluation" | "suggestions" | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [chatContext, setChatContext] = useState<ChatMessage[]>([]);
  const [endpoint, setEndpoint] = useState("");
  const [modelName, setModelName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [selectedWorkspaceIdentity, setSelectedWorkspaceIdentity] = useState<string | null>(null);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatGenerating, setChatGenerating] = useState(false);
  const [planningBusy, setPlanningBusy] = useState(false);
  const [planDirty, setPlanDirty] = useState(false);
  const [materials, setMaterials] = useState("");
  const [instructions, setInstructions] = useState("");
  const [target, setTarget] = useState("");
  const [replacement, setReplacement] = useState("");
  const [checkDescription, setCheckDescription] = useState("独立检查修改后的文件");
  const [readPaths, setReadPaths] = useState("");
  const [writePaths, setWritePaths] = useState("");
  const [writablePaths, setWritablePaths] = useState("");
  const [executable, setExecutable] = useState("");
  const [args, setArgs] = useState("");
  const [cwd, setCwd] = useState(".");
  const [seconds, setSeconds] = useState("120");
  const [commandSeconds, setCommandSeconds] = useState("60");
  const [maxCalls, setMaxCalls] = useState("12");
  const [maxActions, setMaxActions] = useState("12");
  const [maxCommands, setMaxCommands] = useState("4");
  const [maxOutput, setMaxOutput] = useState("100000");
  const [disclosures, setDisclosures] = useState({
    plan: false,
    "file-content": false,
    "command-output": false,
    review: false,
  });
  const [approvals, setApprovals] = useState({
    files: false,
    commands: false,
    disclosure: false,
    limits: false,
  });
  const [proposalInputs, setProposalInputs] = useState<string | null>(null);
  const tokenRef = useRef("");
  const advancedRef = useRef<HTMLDetailsElement>(null);
  const submittedChat = useRef<{ messages: string; input: string } | null>(null);
  const conversationChat = useRef(false);

  useEffect(() => {
    const container = messagesRef.current;
    if (container && conversation.length) container.scrollTop = container.scrollHeight;
  }, [conversation.length]);

  useEffect(() => {
    const submitted = submittedChat.current;
    const chat = state?.chat;
    if (!submitted || chat?.status !== "completed" || chat.messages.length < 2) return;
    const last = chat.messages[chat.messages.length - 1];
    if (
      last?.role !== "assistant" ||
      JSON.stringify(chat.messages.slice(0, -1)) !== submitted.messages
    )
      return;
    if (conversationChat.current) {
      setConversation((messages) => [
        ...messages,
        { role: "assistant", label: "真实模型回复", content: last.content },
      ]);
      conversationChat.current = false;
    }
    setChatInput((current) => (current === submitted.input ? "" : current));
    submittedChat.current = null;
  }, [state?.chat]);

  useEffect(() => {
    void fetch("/api/bootstrap", { headers: clientHeader })
      .then(async (response) => {
        if (!response.ok) throw new Error("无法连接本地宿主");
        return response.json() as Promise<{ token: string; state: WorkspaceState }>;
      })
      .then((data) => {
        tokenRef.current = data.token;
        setToken(data.token);
        setState(data.state);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "连接失败"));
  }, []);
  const proposalIdentity = state?.execution.proposal?.identity;
  useEffect(() => {
    if (proposalIdentity) {
      setApprovals({ files: false, commands: false, disclosure: false, limits: false });
    }
  }, [proposalIdentity]);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    const headers = { ...clientHeader, "X-CSRF-Token": token };
    const receive = async () => {
      try {
        const response = await fetch("/api/events", { headers, signal: controller.signal });
        if (!response.ok || !response.body) throw new Error("事件流不可用");
        setStream("实时连接");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pending = "";
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          pending += decoder.decode(chunk.value, { stream: true });
          let boundary = pending.indexOf("\n\n");
          while (boundary >= 0) {
            const frame = pending.slice(0, boundary);
            pending = pending.slice(boundary + 2);
            if (frame.startsWith("data: ")) {
              const event = JSON.parse(frame.slice(6)) as WorkflowEvent;
              setEvents((previous) => [...previous.slice(-199), event]);
              void fetch("/api/state", { headers, signal: controller.signal })
                .then(async (snapshot) => {
                  if (!snapshot.ok) throw new Error("状态不可用");
                  const data = (await snapshot.json()) as { state: WorkspaceState };
                  setState((current) =>
                    !current ||
                    current.sessionId !== data.state.sessionId ||
                    data.state.sequence >= current.sequence
                      ? data.state
                      : current,
                  );
                })
                .catch(() => {
                  if (!controller.signal.aborted) setStream("状态更新不可用");
                });
            }
            boundary = pending.indexOf("\n\n");
          }
        }
        if (!controller.signal.aborted) setStream("已断开，不回放缺失事件");
      } catch {
        if (!controller.signal.aborted) setStream("已断开，不回放缺失事件");
      }
    };
    void receive();
    return () => controller.abort();
  }, [token]);

  const action = useCallback(
    async (name: string, payload: unknown, long = false): Promise<WorkspaceState | null> => {
      setError("");
      if (!long) setBusy(true);
      try {
        const response = await fetch(`/api/action/${name}`, {
          method: "POST",
          headers: {
            ...clientHeader,
            "X-CSRF-Token": tokenRef.current,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error(`本地服务拒绝请求 (${response.status})`);
        const body = (await response.json()) as { result: ActionResult };
        setState((current) =>
          !current ||
          current.sessionId !== body.result.state.sessionId ||
          body.result.state.sequence >= current.sequence
            ? body.result.state
            : current,
        );
        if (!body.result.ok) throw new Error(body.result.error?.message ?? "操作未完成");
        return body.result.state;
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "操作失败");
        return null;
      } finally {
        if (!long) setBusy(false);
      }
    },
    [],
  );
  const executionInputs = JSON.stringify({
    readPaths,
    writePaths,
    writablePaths,
    executable,
    args,
    cwd,
    seconds,
    commandSeconds,
    maxCalls,
    maxActions,
    maxCommands,
    maxOutput,
    disclosures,
  });
  const proposalChanged = proposalInputs === null || proposalInputs !== executionInputs;
  useEffect(() => {
    if (
      proposalInputs === null ||
      proposalInputs === executionInputs ||
      !state?.execution.proposal ||
      !["proposed", "authorized", "running"].includes(state.execution.status)
    )
      return;
    setProposalInputs(null);
    setApprovals({ files: false, commands: false, disclosure: false, limits: false });
    void action("execution.cancel", {});
  }, [action, executionInputs, proposalInputs, state?.execution.proposal, state?.execution.status]);

  async function discover() {
    const result = await action("workspace.discover", {
      root,
      exclusions: lines(excluded).map((path) => ({ path, reason: "用户排除" })),
    });
    if (result) {
      setSelectedPaths([]);
      setSelectedWorkspaceIdentity(null);
      setReadPaths("");
      setWritePaths("");
      setWritablePaths("");
    }
  }
  async function offline() {
    const result = await action("model.offline", {
      targetPath: target,
      replacement,
      checkDescription,
    });
    if (result) {
      setReadPaths(target);
      setWritePaths(target);
      setArgs(target);
    }
  }
  async function createPlan() {
    const id = crypto.randomUUID();
    const sources = [
      {
        id: "request",
        kind: "user",
        locator: "local-user",
        version: "1",
        content: task,
        status: "available",
      },
      ...(materials.trim()
        ? [
            {
              id: "material",
              kind: "reference",
              locator: "local-user-material",
              version: "1",
              content: materials,
              status: "available",
            },
          ]
        : []),
    ];
    const created = await action("planning.create", {
      id,
      inputs: {
        task: {
          schema: "lorelum.judge.task-contract/v1",
          id: `task-${id}`,
          taskClass: "code",
          text: task,
        },
        sources,
      },
    });
    if (created) await action("planning.preview", { instructions: "" });
  }
  async function startPlanning(text: string) {
    if (!text.trim()) {
      setError("请先填写修改意见。");
      return;
    }
    if (state?.model?.mode !== "configured") {
      setError("请先配置真实模型；配置本身不会发送消息。");
      return;
    }
    setTask(text);
    setPlanDirty(false);
    const id = crypto.randomUUID();
    const hasEvaluation =
      !!state.evaluation.report && ["completed", "partial"].includes(state.evaluation.status);
    const history = conversation
      .filter((message) => message.role === "user" || message.label === "真实模型回复")
      .map(({ role, content }) => ({ role, content }));
    const conversationContext = history.length ? JSON.stringify(history) : "";
    const paths = selectedWorkspaceIdentity === state.workspace?.identity ? selectedPaths : [];
    const created = hasEvaluation
      ? await action("planning.fromEvaluation", {
          id,
          text,
          paths,
          workspaceIdentity: selectedWorkspaceIdentity,
          ...(conversationContext ? { conversation: conversationContext } : {}),
          ...(materials.trim() ? { materials } : {}),
        })
      : await action("planning.create", {
          id,
          paths,
          workspaceIdentity: selectedWorkspaceIdentity,
          inputs: {
            task: {
              schema: "lorelum.judge.task-contract/v1",
              id: `task-${id}`,
              taskClass: "code",
              text,
            },
            sources: [
              {
                id: "request",
                kind: "user",
                locator: "local-user",
                version: "1",
                content: text,
                status: "available",
              },
              ...(materials.trim()
                ? [
                    {
                      id: "material",
                      kind: "reference",
                      locator: "local-user-material",
                      version: "1",
                      content: materials,
                      status: "available",
                    },
                  ]
                : []),
              ...(conversationContext
                ? [
                    {
                      id: "conversation",
                      kind: "reference",
                      locator: "visible-conversation",
                      version: "1",
                      content: conversationContext,
                      status: "available",
                    },
                  ]
                : []),
            ],
          },
        });
    if (created) {
      setTrackingPlan(true);
      setInstructions("");
      const preview = await action("planning.preview", { instructions: "" });
      if (!preview)
        setConversation((messages) => [
          ...messages,
          { role: "assistant", content: "无法预览规划请求，请查看错误并重试。" },
        ]);
    } else {
      setConversation((messages) => [
        ...messages,
        { role: "assistant", content: "无法创建修改计划，请查看错误并重试。" },
      ]);
    }
  }

  async function consentAndGeneratePlan() {
    const pending = state?.disclosure;
    if (!pending || planDirty) return;
    const request = JSON.stringify(pending.request);
    setPlanningBusy(true);
    try {
      const authorized = await action("planning.authorize", { identity: pending.identity });
      if (!authorized) return;
      if (
        !authorized.disclosure?.authorized ||
        authorized.disclosure.identity !== pending.identity ||
        JSON.stringify(authorized.disclosure.request) !== request
      ) {
        setError("披露已变化，请重新预览并授权。");
        return;
      }
      await action("planning.generate", { identity: pending.identity }, true);
    } finally {
      setPlanningBusy(false);
    }
  }

  async function propose() {
    if (!state?.plan || !state.workspace || !state.model) {
      setError("先选择工作区、模型并确认计划");
      return;
    }
    try {
      const parsed = lines(args);
      if (!executable.trim()) throw new Error("请填写实际要运行的检查程序绝对路径。");
      const totalTimeMs = Number(seconds) * 1000;
      const commandTimeMs = Number(commandSeconds) * 1000;
      const command = { executable, args: parsed, cwd };
      const permission = {
        planIdentity: state.plan.identity,
        planRevision: state.plan.revision,
        workspaceIdentity: state.workspace.identity,
        readPaths: lines(readPaths),
        commandReadPaths: ["."],
        writePaths: lines(writePaths),
        writablePaths: lines(writablePaths),
        commands: [command],
        disclosures: Object.entries(disclosures)
          .filter(([, allowed]) => allowed)
          .map(([name]) => name),
        modelRecipient: state.model.recipient,
        limits: {
          totalTimeMs,
          commandTimeMs,
          modelCalls: Number(maxCalls),
          actions: Number(maxActions),
          commands: Number(maxCommands),
          outputBytes: Number(maxOutput),
        },
        expiresAt: Date.now() + totalTimeMs,
        isolation: "bubblewrap-no-network",
      };
      const checks = state.plan.plan.checks.map((check) => ({
        id: check.id,
        version: null,
        environmentIdentity: null,
        ...command,
        readPaths: ["."],
        timeoutMs: commandTimeMs,
        maxOutputBytes: Math.min(8192, Number(maxOutput)),
      }));
      const proposed = await action("execution.propose", { permission, verification: { checks } });
      if (proposed) setProposalInputs(executionInputs);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法创建提案");
    }
  }
  const proposal = state?.execution.proposal;
  const ready = Object.values(approvals).every(Boolean);
  const chatMessages = state?.chat?.messages ?? [];
  const chatRunning = chatGenerating || state?.chat?.status === "running";
  const pendingMessages: ChatMessage[] = [...chatContext, { role: "user", content: chatInput }];
  const chatDisclosure = state?.chatDisclosure;
  const previewMatches =
    !!chatDisclosure &&
    JSON.stringify(chatDisclosure.request.messages) === JSON.stringify(pendingMessages);
  const analysisRunning =
    !!analysisBusy ||
    state?.evaluation?.status === "running" ||
    state?.suggestions?.status === "running";

  useEffect(() => {
    if (!trackedAnalysis || !state) return;
    const result = state[trackedAnalysis];
    if (!["completed", "partial", "failed", "cancelled"].includes(result.status)) return;
    const label = trackedAnalysis === "evaluation" ? "评价" : "修改建议";
    setConversation((messages) => [
      ...messages,
      {
        role: "assistant",
        label: "真实结果",
        content: `${label} · ${result.status}\n${result.text ?? ""}${result.issues !== null ? `\n问题与限制：\n${pretty(result.issues)}` : ""}`,
      },
    ]);
    setTrackedAnalysis(null);
  }, [state, trackedAnalysis]);

  useEffect(() => {
    if (!trackingPlan || !state?.plan) return;
    const plan = state.plan;
    const key = `${plan.identity}:${plan.revision}`;
    if (seenPlan.current === key) return;
    seenPlan.current = key;
    setConversation((messages) => [
      ...messages,
      {
        role: "assistant",
        label: "真实计划",
        content: `修改计划 · 版本 ${plan.revision}\n目标：${plan.plan.goal}\n步骤：\n${plan.plan.steps.map((item) => `- ${item.description}`).join("\n")}\n检查：\n${plan.plan.checks.map((item) => `- ${item.description}`).join("\n")}\n请在下方审核完整计划并确认或拒绝。`,
      },
    ]);
  }, [state?.plan, trackingPlan]);

  useEffect(() => {
    const pending = state?.executionDisclosure ?? state?.disclosure;
    if (!pending || seenDisclosure.current === pending.identity) return;
    seenDisclosure.current = pending.identity;
    setConversation((messages) => [
      ...messages,
      {
        role: "assistant",
        content: `有一项发送至 ${pending.recipient} 的真实模型请求等待审核。请在下方查看完整披露并单独决定是否同意。`,
      },
    ]);
  }, [state?.executionDisclosure, state?.disclosure]);

  async function sendConversation() {
    const text = conversationInput.trim();
    if (!text) return;
    setConversation((messages) => [...messages, { role: "user", content: text }]);
    setConversationInput("");
    const respond = (content: string) =>
      setConversation((messages) => [...messages, { role: "assistant", content }]);
    if (state?.model?.mode !== "configured") {
      respond("请先配置真实模型；配置本身不会发送消息。");
      return;
    }
    if (feature === "planning") {
      await startPlanning(text);
      return;
    }
    let payload: unknown = {};
    if (feature === "evaluation") {
      const pr = text.match(
        /(https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9]\d*)\/?(?:[?#/][^\s]*)?/i,
      );
      const fence = text.match(/```[^\n]*\n([\s\S]*?)```/);
      if (fence || explicitSnippet) {
        const code = fence ? (fence[1] ?? "") : text;
        const request = fence ? text.replace(fence[0], "").trim() : "";
        if (!code.trim()) {
          respond("代码材料为空，请提供代码或 GitHub PR 链接。");
          return;
        }
        payload = { target: { kind: "snippet", text: code }, ...(request ? { request } : {}) };
      } else if (pr) {
        const url = pr[1];
        const request = text.replace(pr[0], "").trim();
        payload = { target: url, ...(request ? { request } : {}) };
      } else {
        const context: ChatMessage[] = conversation
          .filter(
            (message) =>
              message.role === "user" ||
              message.label === "真实结果" ||
              message.label === "真实计划" ||
              message.label === "真实模型回复",
          )
          .map(({ role, content }) => ({ role, content }));
        respond(
          "普通对话不会自动读取项目；当前评价、建议和普通对话可能作为上下文，发送前请审核完整请求。",
        );
        conversationChat.current = true;
        setChatContext(context);
        setChatInput(text);
        setChatBusy(true);
        const preview = await action("chat.preview", {
          messages: [...context, { role: "user", content: text }],
        });
        if (!preview) {
          conversationChat.current = false;
          respond("无法预览对话请求，请查看错误后重试。");
        }
        setChatBusy(false);
        return;
      }
    } else {
      if (!state.evaluation.report || !["completed", "partial"].includes(state.evaluation.status)) {
        respond("当前没有可用的真实评价报告，请先完成评价。");
        return;
      }
      respond(
        "将基于当前评价生成建议。此接口不接收本条消息中的自定义指导，因此这些文字不会发送给模型。",
      );
    }
    setAnalysisBusy(feature);
    try {
      const started = await action(`${feature}.start`, payload, true);
      if (started) setTrackedAnalysis(feature);
      else respond("操作未能开始，请查看错误后重试。");
    } finally {
      setAnalysisBusy(null);
    }
  }

  async function consentAndSendChat() {
    if (!chatDisclosure || !previewMatches) return;
    const identity = chatDisclosure.identity;
    const request = JSON.stringify(chatDisclosure.request);
    setChatBusy(true);
    try {
      const authorized = await action("chat.authorize", { identity });
      if (!authorized) return;
      if (
        !authorized.chatDisclosure?.authorized ||
        authorized.chatDisclosure.identity !== identity ||
        JSON.stringify(authorized.chatDisclosure.request) !== request
      ) {
        setError("披露已变化，请重新预览并授权。");
        return;
      }
      submittedChat.current = {
        messages: JSON.stringify(chatDisclosure.request.messages),
        input: chatInput,
      };
      setChatGenerating(true);
      const result = await action("chat.generate", { identity }, true);
      if (result) setChatInput("");
      else if (conversationChat.current) {
        conversationChat.current = false;
        submittedChat.current = null;
        setConversation((messages) => [
          ...messages,
          { role: "assistant", content: "真实模型对话未完成，请查看错误后重试。" },
        ]);
      }
    } finally {
      setChatGenerating(false);
      setChatBusy(false);
    }
  }
  const canSend =
    !!token &&
    !busy &&
    !chatBusy &&
    !chatRunning &&
    !chatDisclosure &&
    !analysisRunning &&
    !planningBusy &&
    !!conversationInput.trim();

  return (
    <LumenProvider>
      <div className="shell">
        <header className="hero">
          <div className="brand">
            <div className="brand-mark" aria-hidden="true">
              L
            </div>
            <div>
              <div className="eyebrow">
                Lorelum Judge <span> / </span> Local workspace
              </div>
              <h1>代码评价与受控修改</h1>
              <p className="muted">从一个问题开始，到有依据的修改。</p>
            </div>
          </div>
          <span className="state">
            <span className="state-dot" />
            {state ? `会话 ${state.execution.status}` : "正在连接"}
          </span>
        </header>
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        <div className="chat-layout">
          <Card className="section conversation">
            <div className="conversation-heading">
              <div>
                <div className="conversation-kicker">WORKSPACE / 对话</div>
                <h2>和 Judge 一起解决问题</h2>
                <p className="muted">选择当前要做的事，切换后仍在同一段对话中。</p>
              </div>
              <span className="privacy-note">本地会话</span>
            </div>
            <div className="row feature-choices">
              {(
                [
                  ["evaluation", "代码 / PR 评价"],
                  ["suggestions", "修改建议"],
                  ["planning", "修改计划与执行"],
                ] as const
              ).map(([key, label]) => (
                <Button
                  key={key}
                  aria-pressed={feature === key}
                  variant={feature === key ? "solid" : "flat"}
                  onClick={() => setFeature(key)}
                >
                  {label}
                </Button>
              ))}
            </div>
            {state?.model?.mode !== "configured" && (
              <p className="notice model-notice">
                请先在模型设置中配置真实模型。配置本身不会发送请求。
              </p>
            )}
            <div
              className={`messages${conversation.length ? " has-messages" : ""}`}
              aria-live="polite"
              ref={messagesRef}
            >
              {conversation.length === 0 && (
                <div className="empty-chat">
                  <div className="empty-icon" aria-hidden="true">
                    L
                  </div>
                  <h3>今天想解决什么问题？</h3>
                  <p>发来 PR 链接或代码，也可以从下面的方向开始。</p>
                  <div className="starter-grid">
                    <Button
                      variant="flat"
                      onClick={() => {
                        setFeature("evaluation");
                        setConversationInput("请审查这个 PR：");
                      }}
                    >
                      <span>01</span>
                      <strong>审查代码或 PR</strong>
                      <small>发现问题与依据</small>
                    </Button>
                    <Button
                      variant="flat"
                      onClick={() => {
                        setFeature("suggestions");
                        setConversationInput("请根据当前评价给出修改建议");
                      }}
                    >
                      <span>02</span>
                      <strong>获取修改建议</strong>
                      <small>基于已有评价</small>
                    </Button>
                    <Button
                      variant="flat"
                      onClick={() => {
                        setFeature("planning");
                        setConversationInput("请帮我制定修改计划：");
                      }}
                    >
                      <span>03</span>
                      <strong>制定修改计划</strong>
                      <small>确认后再受控执行</small>
                    </Button>
                  </div>
                  <p className="empty-hint">会话仅保留在当前页面，刷新后不恢复消息历史。</p>
                </div>
              )}
              {conversation.map((message, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: Messages are append-only.
                <div key={index}>
                  <Message
                    from={message.role === "assistant" && !message.label ? "system" : message.role}
                    className={`chat-message ${message.role}`}
                  >
                    <Message.Header className="message-label">
                      {message.role === "user" ? "你" : (message.label ?? "界面提示")}
                    </Message.Header>
                    <Message.Content
                      variant={message.role === "user" ? "bubble" : "plain"}
                      className="message-content"
                    >
                      {message.content}
                    </Message.Content>
                    {message.role === "assistant" && message.label && (
                      <Message.Actions>
                        <Message.Copy value={message.content} />
                      </Message.Actions>
                    )}
                  </Message>
                </div>
              ))}
            </div>
            <div className="composer">
              <p className="muted">
                {feature === "evaluation"
                  ? "发送含 GitHub PR 链接的自然语言，或用代码块提供代码。PR 会读取公开信息及相关仓库内容；私有仓库认证暂未接入。"
                  : feature === "suggestions"
                    ? "发送消息以根据当前真实评价生成建议；此接口不接收自定义指导，不会修改代码。"
                    : "描述修改需求；有当前评价时以评价作为参考。无需代码或项目即可规划，执行才需要项目和独立授权。"}
              </p>
              <PromptInput
                variant="flat"
                className="prompt-surface"
                submitDisabled={!canSend}
                onSubmit={() => void sendConversation()}
              >
                <label className="prompt-label" htmlFor="conversation-message">
                  消息
                </label>
                <PromptInput.Textarea
                  id="conversation-message"
                  aria-label="消息"
                  value={conversationInput}
                  onChange={(event) => setConversationInput(event.target.value)}
                  placeholder={
                    feature === "evaluation"
                      ? "请审核 https://github.com/owner/repo/pull/123，重点关注安全性"
                      : feature === "suggestions"
                        ? "请根据当前评价生成修改建议"
                        : "请描述希望如何修改"
                  }
                />
                {feature === "evaluation" && (
                  <details>
                    <summary>代码输入选项</summary>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={explicitSnippet}
                        onChange={(event) => setExplicitSnippet(event.target.checked)}
                      />
                      整条消息是代码材料
                    </label>
                  </details>
                )}
                <div className="row">
                  <PromptInput.Submit aria-label="发送" size="sm">
                    发送
                  </PromptInput.Submit>
                  <span className="muted">Enter 发送 · Shift+Enter 换行</span>
                  {chatRunning && chatInput !== "连接检查：请回复“连接成功”。" && (
                    <Button
                      variant="flat"
                      color="danger"
                      onClick={() => {
                        conversationChat.current = false;
                        void action("chat.cancel", {});
                        setConversation((messages) => [
                          ...messages,
                          { role: "assistant", content: "已取消普通对话请求。" },
                        ]);
                      }}
                    >
                      取消对话
                    </Button>
                  )}
                  {analysisRunning && (
                    <Button
                      variant="flat"
                      color="danger"
                      onClick={() =>
                        void action(
                          `${analysisBusy ?? (state?.evaluation.status === "running" ? "evaluation" : "suggestions")}.cancel`,
                          {},
                        )
                      }
                    >
                      取消生成
                    </Button>
                  )}
                </div>
              </PromptInput>
            </div>
            {(["evaluation", "suggestions"] as const).map((kind) => {
              const result = state?.[kind];
              if (!result || result.status === "idle") return null;
              return (
                <details className="result-panel" key={kind}>
                  <summary>
                    宿主当前{kind === "evaluation" ? "评价" : "建议"}状态 · {result.status}
                    （不一定对应最近发送的消息）
                  </summary>
                  {result.text && <p className="result-text">{result.text}</p>}
                  {result.report !== null && <DisclosureView value={result.report} />}
                  {result.issues !== null && <DisclosureView value={result.issues} />}
                </details>
              );
            })}
            {chatDisclosure && previewMatches && (
              <div className="chat-disclosure">
                <h3>本次发送披露</h3>
                <p className="muted">
                  接收方：{chatDisclosure.recipient} · 模式：{chatDisclosure.mode}
                </p>
                <p className="muted">以下为完整消息和有效配置；请确认不含不愿发送的敏感内容。</p>
                <DisclosureView value={chatDisclosure.request} />
                <details>
                  <summary>查看原始请求</summary>
                  <pre className="data">{pretty(chatDisclosure.request)}</pre>
                </details>
                <div className="row">
                  <Button onClick={() => void consentAndSendChat()} disabled={busy || chatBusy}>
                    同意并发送
                  </Button>
                  <Button
                    variant="flat"
                    disabled={busy || chatBusy}
                    onClick={() => {
                      conversationChat.current = false;
                      void action("chat.cancel", {});
                    }}
                  >
                    取消本次请求
                  </Button>
                </div>
              </div>
            )}
            {chatDisclosure && !previewMatches && (
              <div className="notice">
                消息已变化或页面已刷新，请取消旧请求并重新预览。
                <Button
                  variant="flat"
                  disabled={busy || chatBusy}
                  onClick={() => {
                    conversationChat.current = false;
                    void action("chat.cancel", {});
                  }}
                >
                  取消旧请求
                </Button>
              </div>
            )}
            {(state?.disclosure || (feature === "planning" && state?.plan) || planningBusy) && (
              <Card className="section workflow-card">
                <h2>03 · 计划和披露</h2>
                <p className="muted">
                  先查看本次接收方、任务、资料、旧计划和修改意见，再单独授权请求。新版本使旧确认失效；模型提出的标准仅为提议。
                </p>
                {state?.plan && (
                  <>
                    <label className="field">
                      要求调整的意见
                      <Textarea
                        value={instructions}
                        disabled={busy || planningBusy}
                        onChange={(event) => {
                          setInstructions(event.target.value);
                          if (state.disclosure) {
                            void action("planning.revokeDisclosure", {});
                          }
                        }}
                      />
                    </label>
                    <Button
                      variant="flat"
                      disabled={busy || planningBusy || planDirty || !instructions.trim()}
                      onClick={() => {
                        setPlanDirty(false);
                        void action("planning.preview", { instructions });
                      }}
                    >
                      预览调整请求
                    </Button>
                  </>
                )}
                {planningBusy && (
                  <p role="status" className="muted">
                    正在生成计划，请稍候…
                  </p>
                )}
                {state?.disclosure && (
                  <>
                    <p className="muted">
                      接收方：{state.disclosure.recipient} ·{" "}
                      {state.disclosure.authorized ? "已授权该次请求" : "尚未授权"}
                    </p>
                    <DisclosureView value={state.disclosure.request} />
                    <details>
                      <summary>查看原始请求</summary>
                      <pre className="data">{pretty(state.disclosure.request)}</pre>
                    </details>
                    <Button
                      disabled={busy || planningBusy || planDirty}
                      onClick={() => void consentAndGeneratePlan()}
                    >
                      同意本次发送并生成计划
                    </Button>
                  </>
                )}
                {state?.plan && (
                  <>
                    <p className="muted">
                      版本 {state.plan.revision} · {state.plan.status} ·{" "}
                      {state.plan.acceptanceProposed ? "完成标准为模型提议" : "完成标准来自任务"}
                    </p>
                    <h3>目标</h3>
                    <p>{state.plan.plan.goal}</p>
                    <h3>完成标准</h3>
                    <ul>
                      {state.plan.plan.task.acceptance.map((item) => (
                        <li key={item.id}>
                          {item.id}：{item.text}（来源：{item.source.origin} / {item.source.ref}）
                        </li>
                      ))}
                    </ul>
                    <h3>范围</h3>
                    <ul>
                      {state.plan.plan.scope.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                    <h3>步骤</h3>
                    <ul>
                      {state.plan.plan.steps.map((item) => (
                        <li key={item.id}>
                          {item.description}（对应：{item.acceptanceIds.join("、")}）
                        </li>
                      ))}
                    </ul>
                    <h3>检查</h3>
                    <ul>
                      {state.plan.plan.checks.map((item) => (
                        <li key={item.id}>
                          {item.description}（对应：{item.acceptanceIds.join("、")}）
                        </li>
                      ))}
                    </ul>
                    <h3>不包含 / 待澄清</h3>
                    <p>
                      {[...state.plan.plan.nonGoals, ...state.plan.plan.missing].join("；") || "无"}
                    </p>
                    {state.plan.plan.conflicts.length > 0 && (
                      <>
                        <h3>待解决冲突</h3>
                        <ul>
                          {state.plan.plan.conflicts.map((item) => (
                            <li key={`${item.description}:${item.sourceIds.join(",")}`}>
                              {item.description}（来源：{item.sourceIds.join("、")}）
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    <details>
                      <summary>查看完整计划</summary>
                      <pre className="data">{pretty(state.plan.plan)}</pre>
                    </details>
                    <div className="row">
                      <Button
                        onClick={() =>
                          void action("planning.confirm", {
                            identity: state.plan?.identity,
                            revision: state.plan?.revision,
                          })
                        }
                        disabled={busy || planDirty || state.plan.status !== "draft"}
                      >
                        确认此版本计划
                      </Button>
                      <Button
                        variant="flat"
                        color="danger"
                        onClick={() => void action("planning.reject", {})}
                        disabled={busy}
                      >
                        拒绝 / 撤销计划
                      </Button>
                    </div>
                  </>
                )}
              </Card>
            )}
            {feature === "planning" && !planDirty && state?.plan?.eligible && (
              <Card className="section workflow-card">
                <h2>04 · 审核执行权限</h2>
                <p className="muted">
                  计划确认不授权执行。填写具体文件和命令；命令在隔离副本中执行，读取整个副本。配置改变后须重新生成提案并审核。
                </p>
                <p className="muted">
                  分别勾选模型在候选副本中可读取、可修改的具体文件，初始不授予任何文件权限。检查命令可读取整个候选副本。
                </p>
                <div className="path-list">
                  {state.workspace?.candidates
                    .filter((candidate) => !candidate.exclusionReason)
                    .map((candidate) => (
                      <div className="permission-path" key={candidate.path}>
                        <span>{candidate.path}</span>
                        {(
                          [
                            ["读取", readPaths, setReadPaths],
                            ["写入", writePaths, setWritePaths],
                          ] as const
                        ).map(([label, value, setter]) => (
                          <label className="check" key={label}>
                            <input
                              type="checkbox"
                              checked={lines(value).includes(candidate.path)}
                              onChange={(event) => {
                                const paths = lines(value).filter(
                                  (path) => path !== candidate.path,
                                );
                                if (event.target.checked) paths.push(candidate.path);
                                setter(paths.join("\n"));
                              }}
                            />
                            {label}
                          </label>
                        ))}
                      </div>
                    ))}
                </div>
                <details>
                  <summary>手动指定其他相对路径及命令可写子目录</summary>
                  <label className="field">
                    可读取文件（每行一个）
                    <Textarea
                      value={readPaths}
                      onChange={(event) => setReadPaths(event.target.value)}
                    />
                  </label>
                  <label className="field">
                    可写文件（每行一个）
                    <Textarea
                      value={writePaths}
                      onChange={(event) => setWritePaths(event.target.value)}
                    />
                  </label>
                  <label className="field">
                    命令可写子目录（每行一个，可留空）
                    <Textarea
                      value={writablePaths}
                      onChange={(event) => setWritablePaths(event.target.value)}
                    />
                  </label>
                </details>
                <p className="muted">
                  请选择真实的检查程序和参数；同一命令将用于计划中的每项独立检查。运行后才会显示实际结果，不代表模型已经执行过检查。
                </p>
                <div className="grid2">
                  <label className="field">
                    检查程序绝对路径
                    <Input
                      value={executable}
                      onChange={(event) => setExecutable(event.target.value)}
                    />
                  </label>
                  <label className="field">
                    工作目录
                    <Input value={cwd} onChange={(event) => setCwd(event.target.value)} />
                  </label>
                </div>
                <label className="field">
                  命令参数（每行一个参数；不经过 shell）
                  <Textarea value={args} onChange={(event) => setArgs(event.target.value)} />
                </label>
                <p className="muted">
                  资源限制：总计 {seconds} 秒、单命令 {commandSeconds} 秒；最多模型调用 {maxCalls}{" "}
                  次、动作 {maxActions} 次、命令 {maxCommands} 次，输出 {maxOutput} 字节。
                </p>
                <details>
                  <summary>调整资源限制</summary>
                  <div className="grid2">
                    <label className="field">
                      总时间 / 秒
                      <Input
                        type="number"
                        value={seconds}
                        onChange={(event) => setSeconds(event.target.value)}
                      />
                    </label>
                    <label className="field">
                      单命令时间 / 秒
                      <Input
                        type="number"
                        value={commandSeconds}
                        onChange={(event) => setCommandSeconds(event.target.value)}
                      />
                    </label>
                    <label className="field">
                      模型调用次数
                      <Input
                        type="number"
                        value={maxCalls}
                        onChange={(event) => setMaxCalls(event.target.value)}
                      />
                    </label>
                    <label className="field">
                      动作次数
                      <Input
                        type="number"
                        value={maxActions}
                        onChange={(event) => setMaxActions(event.target.value)}
                      />
                    </label>
                    <label className="field">
                      命令次数
                      <Input
                        type="number"
                        value={maxCommands}
                        onChange={(event) => setMaxCommands(event.target.value)}
                      />
                    </label>
                    <label className="field">
                      输出预算 / 字节
                      <Input
                        type="number"
                        value={maxOutput}
                        onChange={(event) => setMaxOutput(event.target.value)}
                      />
                    </label>
                  </div>
                </details>
                <p className="muted">
                  数据披露项：真实模型可能产生费用；此处不能保证硬费用、内存或文件读写字节上限。不支持联网安装。
                </p>
                {Object.entries({
                  plan: "计划",
                  "file-content": "文件内容",
                  "command-output": "命令输出",
                  review: "评审资料",
                }).map(([key, label]) => (
                  <label className="check" key={key}>
                    <input
                      type="checkbox"
                      checked={disclosures[key as keyof typeof disclosures]}
                      onChange={(event) =>
                        setDisclosures({ ...disclosures, [key]: event.target.checked })
                      }
                    />
                    允许向选定模型披露{label}
                  </label>
                ))}
                <div className="row">
                  <Button
                    variant="flat"
                    onClick={() => void propose()}
                    disabled={
                      busy ||
                      !state?.plan?.eligible ||
                      !state.workspace ||
                      (!!proposal &&
                        proposalChanged &&
                        ["proposed", "authorized", "running"].includes(state.execution.status))
                    }
                  >
                    生成待审核提案
                  </Button>
                </div>
                {proposal && (
                  <>
                    {proposalChanged && (
                      <p className="notice">权限或命令已变化，请重新生成提案并审核。</p>
                    )}
                    <h3>当前提案与独立检查</h3>
                    <p>
                      模型可读取：{proposal.permission.readPaths.join("、") || "无"}；可修改：
                      {proposal.permission.writePaths.join("、") || "无"}。
                    </p>
                    <p>
                      命令可读取：{proposal.permission.commandReadPaths.join("、") || "无"}
                      ；可写目录：{proposal.permission.writablePaths.join("、") || "无"}。
                    </p>
                    <p>
                      接收方：{proposal.permission.modelRecipient}；允许披露：
                      {proposal.permission.disclosures.join("、") || "无"}。
                    </p>
                    <p>独立检查命令：</p>
                    <ul>
                      {proposal.permission.commands.map((command) => (
                        <li key={JSON.stringify(command)}>
                          {JSON.stringify([command.executable, ...command.args])}（工作目录：
                          {command.cwd}）
                        </li>
                      ))}
                    </ul>
                    <p>
                      授权有效至：{new Date(proposal.permission.expiresAt).toLocaleString()}
                      ；资源上限：
                    </p>
                    <DisclosureView value={proposal.permission.limits} />
                    <details>
                      <summary>查看原始提案</summary>
                      <pre className="data">
                        {pretty({
                          permission: proposal.permission,
                          verification: state?.execution.verification,
                        })}
                      </pre>
                    </details>
                    {Object.entries({
                      files: "已审核文件读写范围",
                      commands: "已审核具体命令与全副本读取",
                      disclosure: "已审核接收方和分别列出的资料披露",
                      limits: "已审核可实施资源上限、期限及费用风险",
                    }).map(([key, label]) => (
                      <label className="check" key={key}>
                        <input
                          type="checkbox"
                          checked={approvals[key as keyof typeof approvals]}
                          onChange={(event) =>
                            setApprovals({ ...approvals, [key]: event.target.checked })
                          }
                        />
                        {label}
                      </label>
                    ))}
                    <div className="row">
                      <Button
                        onClick={() =>
                          void action("execution.authorize", {
                            identity: proposal.identity,
                            decisionRef: `local-user-${crypto.randomUUID()}`,
                          })
                        }
                        disabled={busy || !ready || proposalChanged}
                      >
                        分别授权此提案
                      </Button>
                      <Button
                        onClick={() => void action("execution.run", {}, true)}
                        disabled={state?.execution.status !== "authorized" || proposalChanged}
                      >
                        开始受控执行
                      </Button>
                      <Button
                        variant="flat"
                        color="danger"
                        onClick={() => void action("execution.cancel", {})}
                        disabled={
                          !state || !["authorized", "running"].includes(state.execution.status)
                        }
                      >
                        撤销 / 停止
                      </Button>
                    </div>
                  </>
                )}
              </Card>
            )}
            {(state?.executionDisclosure ||
              (feature === "planning" && (proposal || state?.execution.result))) && (
              <Card className="section workflow-card">
                <h2>{state?.executionDisclosure ? "审核本次模型请求" : `实时执行 · ${stream}`}</h2>
                {feature === "planning" && (
                  <p className="muted">
                    状态：{state?.execution.status ?? "未知"}
                    。断线期间事件不回放；下方仅展示本次连接观察到的事件。
                  </p>
                )}
                {state?.executionDisclosure && (
                  <div className="chat-disclosure">
                    <h3>请审核本次模型请求</h3>
                    <p className="muted">
                      接收方：{state.executionDisclosure.recipient}
                      。以下是本次请求的完整消息与配置；每次发送均须单独同意。
                    </p>
                    <DisclosureView value={state.executionDisclosure.request} />
                    <details>
                      <summary>查看原始请求</summary>
                      <pre className="data">{pretty(state.executionDisclosure.request)}</pre>
                    </details>
                    <div className="row">
                      <Button
                        disabled={busy}
                        onClick={() =>
                          void action("execution.disclosure.allow", {
                            identity: state.executionDisclosure?.identity,
                          })
                        }
                      >
                        同意本次发送
                      </Button>
                      <Button
                        variant="flat"
                        color="danger"
                        disabled={busy}
                        onClick={() =>
                          void action("execution.disclosure.deny", {
                            identity: state.executionDisclosure?.identity,
                          })
                        }
                      >
                        拒绝本次发送
                      </Button>
                    </div>
                  </div>
                )}
                {events.length > 0 && (
                  <p className="muted">
                    最近事件：{events[events.length - 1]?.stage} ·{" "}
                    {events[events.length - 1]?.status} {events[events.length - 1]?.reason ?? ""}
                  </p>
                )}
                <details>
                  <summary>查看实时事件及动作详情</summary>
                  <pre className="data">
                    {pretty({ events, actions: state?.execution.actions ?? [] })}
                  </pre>
                </details>
              </Card>
            )}
            {state?.execution.result && (
              <Card className="section workflow-card">
                <h2>独立检查与评审报告</h2>
                <p className="muted">
                  候选副本：{state?.execution.result?.workspaceRoot ?? "尚未创建或不可用"}
                </p>
                <p className="muted">
                  候选内容身份：
                  {state?.execution.result?.evidence?.candidateIdentity ?? "未知或尚未冻结"}
                </p>
                <p className="muted">
                  停止状态：{state?.execution.result?.status ?? "未执行"} · 原因：
                  {state?.execution.result?.reason ?? "无或未知"}
                </p>
                <h3>独立检查</h3>
                {state.execution.result.evidence?.checks.length ? (
                  <ul>
                    {state.execution.result.evidence.checks.map((check) => (
                      <li key={check.id}>
                        {check.id}：
                        {check.status === "passed"
                          ? "通过"
                          : check.status === "failed"
                            ? "失败"
                            : check.status}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>未执行或不可用</p>
                )}
                <h3>评审结果</h3>
                <p>
                  评审：
                  {state.execution.result.evidence?.reviewStatus === "completed"
                    ? "已完成"
                    : "未完成或不可用"}
                  ；质量结论：
                  {state.execution.result.report?.quality === "unknown"
                    ? "未知（不能据此强制通过）"
                    : (state.execution.result.report?.quality ?? "未知")}
                </p>
                <details>
                  <summary>查看原始结果</summary>
                  <pre className="data">{pretty(state.execution.result)}</pre>
                </details>
                <h3>原始现场与候选差异</h3>
                <p className="muted">
                  {state?.execution.result?.report?.diff !== null &&
                  state?.execution.result?.report?.diff !== undefined
                    ? "已获准在本地显示差异；未因此扩大模型披露。"
                    : (state?.execution.result?.report?.diffUnavailable ?? "差异尚不可用")}
                </p>
                {state?.execution.diffAvailable && !state.execution.diffRevealed && (
                  <Button
                    variant="flat"
                    onClick={() => void action("report.reveal", { allowFullCandidateDiff: true })}
                  >
                    允许本地显示完整差异
                  </Button>
                )}
                <pre className="data">{state?.execution.result?.report?.diff ?? "未显示"}</pre>
              </Card>
            )}
          </Card>
          <aside className="stack">
            <Card className="section">
              <h2>真实模型设置</h2>
              <p className="muted">
                模型：{state?.model ? `${state.model.recipient} · ${state.model.mode}` : "尚未选择"}
              </p>
              <label className="field">
                OpenAI-compatible endpoint
                <Input
                  value={endpoint}
                  onChange={(event) => setEndpoint(event.target.value)}
                  placeholder="https://api.example.com/v1"
                />
              </label>
              <label className="field">
                模型名称
                <Input value={modelName} onChange={(event) => setModelName(event.target.value)} />
              </label>
              <label className="field">
                API 密钥（可留空，仅保存在宿主内存）
                <Input
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                />
              </label>
              <Button
                disabled={!token || busy || chatBusy || !endpoint.trim() || !modelName.trim()}
                onClick={() => {
                  const credential = apiKey;
                  setApiKey("");
                  void action("model.configure", {
                    endpoint: endpoint.trim(),
                    model: modelName.trim(),
                    apiKey: credential,
                  });
                }}
              >
                保存并选择模型
              </Button>
              <p className="muted">保存不会发送模型请求，更换模型会使相关授权失效。</p>
              <Button
                variant="flat"
                disabled={
                  !token || busy || chatBusy || chatRunning || state?.model?.mode !== "configured"
                }
                onClick={() => {
                  conversationChat.current = false;
                  setChatContext(chatMessages);
                  const content = "连接检查：请回复“连接成功”。";
                  setChatInput(content);
                  setChatBusy(true);
                  void action("chat.preview", {
                    messages: [...chatMessages, { role: "user", content }],
                  }).finally(() => setChatBusy(false));
                }}
              >
                预览连接检查
              </Button>
              <p className="muted">
                检查会发送“连接检查：请回复‘连接成功’。”及现有聊天记录；须先查看完整披露并同意。
              </p>
              {chatRunning && chatInput === "连接检查：请回复“连接成功”。" && (
                <Button
                  variant="flat"
                  color="danger"
                  onClick={() => void action("chat.cancel", {})}
                >
                  取消连接检查
                </Button>
              )}
              {state?.chat?.status === "failed" && chatInput === "连接检查：请回复“连接成功”。" && (
                <p className="notice error">连接检查失败，请检查配置后重新预览。</p>
              )}
              {state?.chat?.status === "completed" &&
                chatMessages.at(-2)?.content === "连接检查：请回复“连接成功”。" && (
                  <div className="result-panel">
                    <h3>连接检查结果</h3>
                    <p className="result-text">{chatMessages[chatMessages.length - 1]?.content}</p>
                  </div>
                )}
            </Card>
            {feature === "planning" && (
              <Card className="section">
                <h2>项目文件夹</h2>
                <p className="muted">只有实际执行时需要选择项目。选择后请重新生成并确认计划。</p>
                <p className="notice">
                  发现会列出 Git
                  已跟踪、未跟踪和忽略文件的路径。请先排除凭据、密钥及其他敏感文件；发现不会发送内容给模型。
                </p>
                <label className="field">
                  项目路径（支持 WSL 路径及 Windows 盘符路径）
                  <Input
                    value={root}
                    onChange={(event) => setRoot(event.target.value)}
                    placeholder="例如 E:\project 或 /home/user/project"
                  />
                </label>
                <details>
                  <summary>排除敏感文件（选择项目前设置）</summary>
                  <label className="field">
                    排除相对路径（每行一个）
                    <Textarea
                      value={excluded}
                      onChange={(event) => setExcluded(event.target.value)}
                      placeholder=".env"
                    />
                  </label>
                </details>
                <Button disabled={!token || busy || !root.trim()} onClick={() => void discover()}>
                  选择项目
                </Button>
                {state?.workspace && (
                  <>
                    <p className="muted">
                      已选择：{state.workspace.root}
                      。勾选的路径及其身份作为规划参考，不发送文件内容；重新选择项目后须重新规划。
                    </p>
                    <div className="path-list">
                      {state.workspace.candidates
                        .filter((candidate) => !candidate.exclusionReason)
                        .map((candidate) => (
                          <label className="check" key={candidate.path}>
                            <input
                              type="checkbox"
                              checked={
                                selectedWorkspaceIdentity === state.workspace?.identity &&
                                selectedPaths.includes(candidate.path)
                              }
                              onChange={(event) => {
                                const checked = event.target.checked;
                                const workspaceIdentity = state.workspace?.identity;
                                if (!workspaceIdentity) return;
                                setSelectedPaths((current) => {
                                  const selected =
                                    selectedWorkspaceIdentity === workspaceIdentity ? current : [];
                                  return checked
                                    ? [...selected, candidate.path]
                                    : selected.filter((path) => path !== candidate.path);
                                });
                                setSelectedWorkspaceIdentity(workspaceIdentity);
                                if (!planDirty && (state.plan || state.disclosure)) {
                                  setPlanDirty(true);
                                  void action("planning.revokeDisclosure", {});
                                }
                              }}
                            />
                            {candidate.path} ({candidate.status})
                          </label>
                        ))}
                    </div>
                  </>
                )}
              </Card>
            )}
          </aside>
        </div>
        <details className="advanced" ref={advancedRef}>
          <summary>高级工作流 · 项目、计划、执行与报告</summary>
          <p className="muted">其他工作区诊断及离线演示选项；执行仍需独立授权。</p>
          <div className="layout">
            <main className="stack">
              <Card className="section">
                <h2>01 · 选择工作区</h2>
                <p className="muted">
                  本地发现会列出 Git
                  已跟踪、未跟踪及忽略文件的路径；在读取文件正文之前，先输入需要排除的相对路径。请排除凭据和敏感材料。发现不等于模型披露。
                </p>
                <label className="field">
                  Git 工作区绝对路径
                  <Input
                    value={root}
                    onChange={(event) => setRoot(event.target.value)}
                    placeholder="例如 /home/user/project"
                  />
                </label>
                <label className="field">
                  排除路径（每行一个，先于内容读取生效）
                  <Textarea
                    value={excluded}
                    onChange={(event) => setExcluded(event.target.value)}
                    placeholder=".env"
                  />
                </label>
                <div className="row">
                  <Button onClick={() => void discover()} disabled={!token || busy || !root.trim()}>
                    发现本地现场
                  </Button>
                </div>
                {state?.workspace && (
                  <>
                    <p className="muted">
                      规范根目录：{state.workspace.root}
                      <br />
                      副本来源身份：{state.workspace.identity}
                    </p>
                    <pre className="data">{pretty(state.workspace.candidates)}</pre>
                    <p className="muted">支持诊断：{pretty(state.diagnostics)}</p>
                  </>
                )}
                <p className="muted">
                  仅支持 Linux、openat2 与 bubblewrap。Git
                  HEAD、冲突索引、隐藏修改标志、链接、特殊文件和 mount
                  必须满足安全约束；隔离工具链能力在实际执行时验证。沙箱无网络、原项目 Git
                  元数据和个人 home；命令必须授权读取整个副本，根目录写入仅通过受控文件写入。
                </p>
              </Card>
              <Card className="section">
                <h2>02 · 模型与任务</h2>
                <p className="muted">
                  可在右侧配置真实模型，选择不会发送请求。离线演示是确定性的单文件替换，不代表真实模型效果。
                </p>
                <label className="field">
                  自然语言修改意见
                  <Textarea
                    value={task}
                    onChange={(event) => setTask(event.target.value)}
                    placeholder="描述你希望修改的行为"
                  />
                </label>
                <label className="field">
                  可选规划资料（仅在明确披露授权后发送）
                  <Textarea
                    value={materials}
                    onChange={(event) => setMaterials(event.target.value)}
                  />
                </label>
                <div className="grid2">
                  <label className="field">
                    离线目标相对路径
                    <Input value={target} onChange={(event) => setTarget(event.target.value)} />
                  </label>
                  <label className="field">
                    检查说明
                    <Input
                      value={checkDescription}
                      onChange={(event) => setCheckDescription(event.target.value)}
                    />
                  </label>
                </div>
                <label className="field">
                  离线替换后的完整文本
                  <Textarea
                    value={replacement}
                    onChange={(event) => setReplacement(event.target.value)}
                  />
                </label>
                <div className="row">
                  <Button
                    variant="flat"
                    onClick={() => void offline()}
                    disabled={busy || !target.trim()}
                  >
                    选择离线演示
                  </Button>
                  <Button
                    variant="flat"
                    onClick={() => void action("model.configured", {})}
                    disabled={busy}
                  >
                    选择宿主配置的真实模型
                  </Button>
                  <Button
                    onClick={() => void createPlan()}
                    disabled={busy || !task.trim() || !state?.model}
                  >
                    创建任务
                  </Button>
                </div>
                {state?.model && (
                  <p className="muted">
                    接收方：{state.model.recipient} · 模式：{state.model.mode}
                    <br />
                    有效配置：{pretty(state.model.config)}
                  </p>
                )}
              </Card>
            </main>
            <aside className="stack"></aside>
          </div>
        </details>
      </div>
    </LumenProvider>
  );
}

const element = document.getElementById("root");
if (!element) throw new Error("Missing application root");
createRoot(element).render(<App />);
