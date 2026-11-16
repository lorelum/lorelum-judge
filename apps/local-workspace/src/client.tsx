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
  plan: { checks: { id: string; description: string }[] };
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
        checks: unknown[];
        review: unknown;
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
  const [chatBusy, setChatBusy] = useState(false);
  const [chatGenerating, setChatGenerating] = useState(false);
  const [materials, setMaterials] = useState("");
  const [instructions, setInstructions] = useState("");
  const [target, setTarget] = useState("");
  const [replacement, setReplacement] = useState("");
  const [checkDescription, setCheckDescription] = useState("独立检查修改后的文件");
  const [readPaths, setReadPaths] = useState("");
  const [writePaths, setWritePaths] = useState("");
  const [writablePaths, setWritablePaths] = useState("");
  const [executable, setExecutable] = useState("/usr/bin/cat");
  const [args, setArgs] = useState("[]");
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
  const tokenRef = useRef("");
  const advancedRef = useRef<HTMLDetailsElement>(null);

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

  async function discover() {
    await action("workspace.discover", {
      root,
      exclusions: lines(excluded).map((path) => ({ path, reason: "用户排除" })),
    });
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
      setArgs(JSON.stringify([target]));
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
  async function propose() {
    if (!state?.plan || !state.workspace || !state.model) {
      setError("先选择工作区、模型并确认计划");
      return;
    }
    try {
      const parsed: unknown = JSON.parse(args);
      if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string"))
        throw new Error("命令参数必须是 JSON 字符串数组");
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
      await action("execution.propose", { permission, verification: { checks } });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法创建提案");
    }
  }
  const proposal = state?.execution.proposal;
  const ready = Object.values(approvals).every(Boolean);
  const chatMessages = state?.chat?.messages ?? [];
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
                      onClick={() => {
                        setTask(message.content);
                        if (advancedRef.current) advancedRef.current.open = true;
                        advancedRef.current?.scrollIntoView({ behavior: "smooth" });
                      }}
                    >
                      用于工作流任务
                    </button>
                  )}
                </article>
              ))}
              {(chatDisclosure || chatGenerating) && chatInput.trim() && (
                <article className="message user">
                  <div className="message-label">{chatGenerating ? "你" : "你 · 待发送"}</div>
                  <div className="message-content">{chatInput}</div>
                </article>
              )}
              {state?.chat?.status === "failed" && (
                <p className="notice error" role="alert">
                  模型请求失败，未生成回复。可检查配置后重新预览并授权。
                </p>
              )}
              {chatBusy && (
                <p className="muted" role="status">
                  正在处理，请稍候…
                </p>
              )}
            </div>
            <label className="field">
              输入消息
              <Textarea
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                placeholder="描述你的问题或想要完成的任务"
                disabled={chatBusy}
              />
            </label>
            <div className="row">
              <Button
                onClick={() => void previewChat()}
                disabled={
                  !token ||
                  busy ||
                  chatBusy ||
                  !chatInput.trim() ||
                  state?.model?.mode !== "configured"
                }
              >
                发送
              </Button>
              <Button
                variant="flat"
                disabled={!chatInput.trim() || chatBusy}
                onClick={() => {
                  setTask(chatInput);
                  if (advancedRef.current) advancedRef.current.open = true;
                  advancedRef.current?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                将输入用于工作流任务
              </Button>
              {chatGenerating && (
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
                <pre className="data">{pretty(chatDisclosure.request)}</pre>
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
          </Card>
          <aside className="stack">
            <Card className="section">
              <h2>项目与模型</h2>
              <p className="muted">项目：{state?.workspace?.root ?? "尚未选择"}</p>
              <p className="muted">
                模型：{state?.model ? `${state.model.recipient} · ${state.model.mode}` : "尚未选择"}
              </p>
              {state?.model?.mode !== "configured" && (
                <p className="notice">
                  聊天需要宿主配置的真实模型。启动宿主前设置 LORELUM_MODEL_ENDPOINT 和
                  LORELUM_MODEL_NAME，必要时设置
                  LORELUM_MODEL_API_KEY，然后重启并选择真实模型。请勿在页面输入密钥。离线演示不能聊天。
                </p>
              )}
              <Button
                variant="flat"
                onClick={() => void action("model.configured", {})}
                disabled={!token || busy || chatBusy}
              >
                选择宿主配置的真实模型
              </Button>
              <p className="muted">
                项目发现、离线演示和其他设置在下方高级工作流中。选择模型不会发送消息。
              </p>
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
                  真实模型只使用宿主配置；选择不发送请求。离线演示是确定性的单文件替换，不代表真实模型效果。
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
              <Card className="section">
                <h2>03 · 计划和披露</h2>
                <p className="muted">
                  先查看本次接收方、任务、资料、旧计划和修改意见，再单独授权请求。新版本使旧确认失效；模型提出的标准仅为提议。
                </p>
                <label className="field">
                  本次修改意见（首次可留空）
                  <Textarea
                    value={instructions}
                    onChange={(event) => setInstructions(event.target.value)}
                  />
                </label>
                <div className="row">
                  <Button
                    variant="flat"
                    onClick={() => void action("planning.preview", { instructions })}
                    disabled={busy || !state?.model}
                  >
                    预览披露
                  </Button>
                  <Button
                    variant="flat"
                    onClick={() =>
                      void action("planning.authorize", { identity: state?.disclosure?.identity })
                    }
                    disabled={busy || !state?.disclosure || state.disclosure.authorized}
                  >
                    明确授权本次披露
                  </Button>
                  <Button
                    onClick={() =>
                      void action(
                        "planning.generate",
                        { identity: state?.disclosure?.identity },
                        true,
                      )
                    }
                    disabled={!state?.disclosure?.authorized}
                  >
                    生成计划
                  </Button>
                </div>
                {state?.disclosure && (
                  <>
                    <p className="muted">
                      接收方：{state.disclosure.recipient} ·{" "}
                      {state.disclosure.authorized ? "已授权该次请求" : "尚未授权"}
                    </p>
                    <pre className="data">{pretty(state.disclosure.request)}</pre>
                  </>
                )}
                {state?.plan && (
                  <>
                    <p className="muted">
                      版本 {state.plan.revision} · {state.plan.status} ·{" "}
                      {state.plan.acceptanceProposed ? "完成标准为模型提议" : "完成标准来自任务"}
                    </p>
                    <pre className="data">{pretty(state.plan.plan)}</pre>
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
              <Card className="section">
                <h2>04 · 审核执行权限</h2>
                <p className="muted">
                  计划确认不授权执行。填写具体文件和命令；命令在隔离副本中执行，读取整个副本。配置改变后须重新生成提案并审核。
                </p>
                <div className="grid2">
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
                </div>
                <label className="field">
                  命令可写子目录（每行一个，可留空）
                  <Textarea
                    value={writablePaths}
                    onChange={(event) => setWritablePaths(event.target.value)}
                  />
                </label>
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
                  命令参数（JSON 字符串数组）
                  <Textarea value={args} onChange={(event) => setArgs(event.target.value)} />
                </label>
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
                    disabled={busy || !state?.plan?.eligible || !state.workspace}
                  >
                    生成待审核提案
                  </Button>
                </div>
                {proposal && (
                  <>
                    <h3>当前提案与独立检查</h3>
                    <pre className="data">
                      {pretty({
                        permission: proposal.permission,
                        verification: state?.execution.verification,
                      })}
                    </pre>
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
                        disabled={busy || !ready}
                      >
                        分别授权此提案
                      </Button>
                      <Button
                        onClick={() => void action("execution.run", {}, true)}
                        disabled={state?.execution.status !== "authorized"}
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
            </main>
            <aside className="stack">
              <Card className="section">
                <h2>实时执行 · {stream}</h2>
                <p className="muted">
                  状态：{state?.execution.status ?? "未知"}
                  。断线期间事件不回放；下方仅展示本次连接观察到的事件。
                </p>
                <pre className="data">{events.length ? pretty(events) : "暂无实时事件"}</pre>
                <h3>已观察动作</h3>
                <pre className="data">{pretty(state?.execution.actions ?? [])}</pre>
              </Card>
              <Card className="section">
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
                <h3>检查命令、状态与输出</h3>
                <pre className="data">
                  {pretty(state?.execution.result?.evidence?.checks ?? "未执行或不可用")}
                </pre>
                <h3>公开 judge 报告</h3>
                <pre className="data">
                  {pretty({
                    quality: state?.execution.result?.report?.quality ?? "unknown",
                    review: state?.execution.result?.evidence?.review ?? null,
                    completeness: state?.execution.result?.evidence?.completeness ?? "unknown",
                    stopReason: state?.execution.result?.evidence?.stopReason ?? null,
                  })}
                </pre>
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
            </aside>
          </div>
        </details>
      </div>
    </LumenProvider>
  );
}

const element = document.getElementById("root");
if (!element) throw new Error("Missing application root");
createRoot(element).render(<App />);
