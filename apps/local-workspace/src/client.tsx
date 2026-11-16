import { Button } from "@lorelum/lumen-ui/components/button";
import { Card } from "@lorelum/lumen-ui/components/card";
import { Input } from "@lorelum/lumen-ui/components/input";
import { Textarea } from "@lorelum/lumen-ui/components/textarea";
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
    steps: { id: string; description: string }[];
    checks: { id: string; description: string }[];
    nonGoals: string[];
    missing: string[];
  };
};
type ChatMessage = { role: "user" | "assistant"; content: string };
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
    proposal: { identity: string; permission: unknown } | null;
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
  const [chatInput, setChatInput] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [modelName, setModelName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatGenerating, setChatGenerating] = useState(false);
  const [planningBusy, setPlanningBusy] = useState(false);
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
    await action("planning.create", {
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
  }
  async function startPlanning(text: string) {
    if (!text.trim()) {
      setError("请先在对话框中描述要完成的任务。");
      return;
    }
    if (!state?.workspace) {
      setError("请先在右侧选择 Git 工作区，并在发现前排除敏感路径。");
      return;
    }
    if (state.model?.mode !== "configured") {
      setError("请先在右侧配置真实模型；配置本身不会发送消息。");
      return;
    }
    setTask(text);
    const id = crypto.randomUUID();
    const created = await action("planning.create", {
      id,
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
          ...(selectedPaths.length
            ? [
                {
                  id: "project-paths",
                  kind: "reference",
                  locator: "user-selected-project-paths",
                  version: "1",
                  content: `用户选择的项目相对路径（仅路径，不含文件内容）：\n${selectedPaths.join("\n")}`,
                  status: "available",
                },
              ]
            : []),
        ],
      },
    });
    if (created) {
      setInstructions("");
      await action("planning.preview", { instructions: "" });
    }
  }

  async function consentAndGeneratePlan() {
    const pending = state?.disclosure;
    if (!pending) return;
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
  const pendingMessages: ChatMessage[] = [...chatMessages, { role: "user", content: chatInput }];
  const chatDisclosure = state?.chatDisclosure;
  const previewMatches =
    !!chatDisclosure &&
    JSON.stringify(chatDisclosure.request.messages) === JSON.stringify(pendingMessages);

  async function previewChat() {
    setChatBusy(true);
    try {
      await action("chat.preview", { messages: pendingMessages });
    } finally {
      setChatBusy(false);
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
    } finally {
      setChatGenerating(false);
      setChatBusy(false);
    }
  }

  return (
    <LumenProvider>
      <div className="shell">
        <header className="hero">
          <div>
            <div className="eyebrow">Lorelum Judge · Local workspace</div>
            <h1>工作区对话</h1>
            <p className="muted">先对话，再审阅计划与权限；修改仅在独立候选副本中执行。</p>
          </div>
          <span className="state">{state ? `会话 ${state.execution.status}` : "正在连接"}</span>
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
                <h2>对话</h2>
                <p className="muted">
                  模型不会自动读取项目或收到消息。每次发送前请检查完整披露并授权。
                </p>
              </div>
              <span className="state">{state?.chat?.status ?? "等待消息"}</span>
            </div>
            <div className="messages" aria-live="polite">
              {chatMessages.length === 0 && (
                <p className="empty-chat">
                  输入你的问题或指令，预览并授权后与宿主配置的真实模型对话。
                </p>
              )}
              {chatMessages.map((message, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: Messages can repeat and rows have no local state.
                <article className={`message ${message.role}`} key={index}>
                  <div className="message-label">{message.role === "user" ? "你" : "模型"}</div>
                  <div className="message-content">{message.content}</div>
                  {message.role === "user" && (
                    <button
                      className="text-action"
                      type="button"
                      onClick={() => void startPlanning(message.content)}
                    >
                      用于工作流任务
                    </button>
                  )}
                </article>
              ))}
              {(chatDisclosure || chatRunning) && chatInput.trim() && (
                <article className="message user">
                  <div className="message-label">{chatRunning ? "你" : "你 · 待发送"}</div>
                  <div className="message-content">{chatInput}</div>
                </article>
              )}
              {state?.chat?.status === "failed" && (
                <p className="notice error" role="alert">
                  模型请求失败，未生成回复。可检查配置后重新预览并授权。
                </p>
              )}
              {(chatBusy || chatRunning) && (
                <p className="muted" role="status">
                  正在处理，请稍候…
                </p>
              )}
            </div>
            {state?.model?.mode !== "configured" && (
              <p className="notice">要与真实模型对话或规划，请先在右侧填写并保存模型设置。</p>
            )}
            {!state?.workspace && (
              <p className="muted">
                需要修改项目？先在右侧排除敏感路径并发现 Git 工作区，然后输入任务并选择“制定计划”。
              </p>
            )}
            <label className="field">
              输入消息
              <Textarea
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                placeholder="描述你的问题或想要完成的任务"
                disabled={chatBusy || chatRunning}
              />
            </label>
            <div className="row">
              <Button
                onClick={() => void previewChat()}
                disabled={
                  !token ||
                  busy ||
                  chatBusy ||
                  chatRunning ||
                  !chatInput.trim() ||
                  state?.model?.mode !== "configured"
                }
              >
                发送
              </Button>
              <Button
                variant="flat"
                disabled={!chatInput.trim() || chatBusy || chatRunning}
                onClick={() => void startPlanning(chatInput)}
              >
                为这条指令制定计划
              </Button>
              {chatRunning && (
                <Button
                  variant="flat"
                  color="danger"
                  onClick={() => void action("chat.cancel", {})}
                >
                  取消模型请求
                </Button>
              )}
            </div>
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
                </div>
              </div>
            )}
            {chatDisclosure && !previewMatches && (
              <p className="notice">消息已变化，请重新预览并授权后发送。</p>
            )}
            {task && (
              <article className="message user">
                <div className="message-label">你的工作流任务</div>
                <div className="message-content">{task}</div>
              </article>
            )}
            {(state?.disclosure || state?.plan || planningBusy) && (
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
                        onChange={(event) => setInstructions(event.target.value)}
                      />
                    </label>
                    <Button
                      variant="flat"
                      disabled={busy || planningBusy || !instructions.trim()}
                      onClick={() => void action("planning.preview", { instructions })}
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
                      disabled={busy || planningBusy}
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
                    <h3>范围</h3>
                    <ul>
                      {state.plan.plan.scope.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                    <h3>步骤</h3>
                    <ul>
                      {state.plan.plan.steps.map((item) => (
                        <li key={item.id}>{item.description}</li>
                      ))}
                    </ul>
                    <h3>检查</h3>
                    <ul>
                      {state.plan.plan.checks.map((item) => (
                        <li key={item.id}>{item.description}</li>
                      ))}
                    </ul>
                    <h3>不包含 / 待澄清</h3>
                    <p>
                      {[...state.plan.plan.nonGoals, ...state.plan.plan.missing].join("；") || "无"}
                    </p>
                    <div className="row">
                      <Button
                        onClick={() =>
                          void action("planning.confirm", {
                            identity: state.plan?.identity,
                            revision: state.plan?.revision,
                          })
                        }
                        disabled={busy || state.plan.eligible}
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
            {state?.plan?.eligible && (
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
                    <DisclosureView
                      value={{
                        permission: proposal.permission,
                        verification: state?.execution.verification,
                      }}
                    />
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
            {(proposal || state?.executionDisclosure || state?.execution.result) && (
              <Card className="section workflow-card">
                <h2>实时执行 · {stream}</h2>
                <p className="muted">
                  状态：{state?.execution.status ?? "未知"}
                  。断线期间事件不回放；下方仅展示本次连接观察到的事件。
                </p>
                {state?.executionDisclosure && (
                  <div className="chat-disclosure">
                    <h3>执行已暂停：请审核本次模型请求</h3>
                    <p className="muted">
                      接收方：{state.executionDisclosure.recipient}
                      。以下是本次请求的完整消息与配置；执行权限不代表同意本次发送。
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
              <h2>项目与模型</h2>
              <p className="muted">项目：{state?.workspace?.root ?? "尚未选择"}</p>
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
                  const content = "连接检查：请回复“连接成功”。";
                  setChatInput(content);
                  setChatBusy(true);
                  void action("chat.preview", {
                    messages: [...chatMessages, { role: "user", content }],
                  }).finally(() => setChatBusy(false));
                }}
              >
                预览连接检查（替换当前输入）
              </Button>
              <p className="muted">
                检查会把“连接检查：请回复‘连接成功’。”以及现有聊天记录发送给所选接收方；须先在对话中查看完整披露并同意。
              </p>
            </Card>
            <Card className="section">
              <h2>Git 工作区</h2>
              <p className="notice">
                发现会列出 Git
                已跟踪、未跟踪和忽略文件的路径。请先排除凭据、密钥及其他敏感文件；发现不会发送内容给模型。
              </p>
              <label className="field">
                工作区绝对路径
                <Input
                  value={root}
                  onChange={(event) => setRoot(event.target.value)}
                  placeholder="/home/user/project"
                />
              </label>
              <label className="field">
                排除相对路径（每行一个）
                <Textarea
                  value={excluded}
                  onChange={(event) => setExcluded(event.target.value)}
                  placeholder=".env"
                />
              </label>
              <Button disabled={!token || busy || !root.trim()} onClick={() => void discover()}>
                发现工作区
              </Button>
              {state?.workspace && (
                <>
                  <p className="muted">
                    已选择：{state.workspace.root}
                    。勾选允许用于规划的路径；只发送名称，不发送文件内容。
                  </p>
                  <div className="path-list">
                    {state.workspace.candidates
                      .filter((candidate) => !candidate.exclusionReason)
                      .map((candidate) => (
                        <label className="check" key={candidate.path}>
                          <input
                            type="checkbox"
                            checked={selectedPaths.includes(candidate.path)}
                            onChange={(event) =>
                              setSelectedPaths((current) =>
                                event.target.checked
                                  ? [...current, candidate.path]
                                  : current.filter((path) => path !== candidate.path),
                              )
                            }
                          />
                          {candidate.path} ({candidate.status})
                        </label>
                      ))}
                  </div>
                </>
              )}
            </Card>
          </aside>
        </div>
        <details className="advanced" ref={advancedRef}>
          <summary>高级工作流 · 项目、计划、执行与报告</summary>
          <p className="muted">
            将对话中的指令用于任务后，在此创建任务、预览并确认计划；执行仍需独立授权。
          </p>
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
