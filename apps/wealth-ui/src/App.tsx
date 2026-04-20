import {
  AssistantRuntimeProvider,
  AuiIf,
  ComposerPrimitive,
  MessagePrimitive,
  makeAssistantToolUI,
  ThreadPrimitive,
  useAuiState,
} from "@assistant-ui/react";
import type {
  PiToolExecutionState,
  PiUiState,
  ThreadMessage,
} from "@niven/wealth-chat-bridge/pi-ui";
import { startTransition, useEffect } from "react";

import { isVisualizationArtifact } from "../../../packages/wealth-chat-bridge/src/visualization.ts";
import { useWealthAssistantRuntime } from "./assistantRuntime";
import { ChatVisualization } from "./ChatVisualization";
import {
  buildThreadEventsUrl,
  createThread,
  disposeThread,
  fetchThreadState,
  formatTransportError,
} from "./chatApi";
import { useChatStore } from "./chatStore";
import { MarkdownBlock, normalizeChatMarkdown } from "./MarkdownBlock";

const EMPTY_MESSAGES: readonly ThreadMessage[] = [];
const EMPTY_EXECUTIONS: Record<string, PiToolExecutionState> = {};

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function truncateMiddle(value: string, visible = 8): string {
  if (value.length <= visible * 2 + 1) {
    return value;
  }

  return `${value.slice(0, visible)}...${value.slice(-visible)}`;
}

function toPreviewText(text: string): string {
  return normalizeChatMarkdown(text)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function summarizePayload(value: unknown): string {
  if (value === undefined) {
    return "No payload";
  }

  if (typeof value === "string") {
    const preview = toPreviewText(value);
    return preview.length > 96 ? `${preview.slice(0, 93)}...` : preview;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return `${value.length} items`;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;

    if (typeof record.accountCount === "number") return `${record.accountCount} accounts`;
    if (typeof record.holdingCount === "number") return `${record.holdingCount} holdings`;
    if (typeof record.orderCount === "number") return `${record.orderCount} orders`;
    if (typeof record.transferCount === "number") return `${record.transferCount} transfers`;
    if (Array.isArray(record.accounts)) return `${record.accounts.length} accounts`;
    if (Array.isArray(record.holdings)) return `${record.holdings.length} holdings`;
    if (Array.isArray(record.orders)) return `${record.orders.length} orders`;
    if (Array.isArray(record.transfers)) return `${record.transfers.length} transfers`;
    if (record.details && typeof record.details === "object")
      return summarizePayload(record.details);
    if (record.summary && typeof record.summary === "object")
      return summarizePayload(record.summary);

    const keys = Object.keys(record).slice(0, 4);
    return keys.length > 0 ? keys.join(" · ") : "Object";
  }

  return String(value);
}

function getPartDefaultOpen(status: string, isError: boolean | undefined): boolean {
  return status === "running" || status === "requires-action" || Boolean(isError);
}

function useThreadBootstrap(): void {
  useEffect(() => {
    let isActive = true;
    let activeThreadId: string | null = null;
    let eventSource: EventSource | null = null;

    const applyState = (nextState: PiUiState) => {
      const { setError, setState } = useChatStore.getState();
      activeThreadId = nextState.threadId;

      startTransition(() => {
        setState(nextState);
        setError(null);
      });
    };

    const setConnection = (connection: "closed" | "connecting" | "error" | "open") => {
      useChatStore.getState().setConnection(connection);
    };

    const setError = (error: string | null) => {
      useChatStore.getState().setError(error);
    };

    const openThreadStream = (threadId: string) => {
      eventSource?.close();
      eventSource = new EventSource(buildThreadEventsUrl(threadId));

      eventSource.addEventListener("open", () => {
        if (!isActive) {
          return;
        }

        setConnection("open");
      });

      eventSource.addEventListener("state", async (event) => {
        if (!isActive) {
          return;
        }

        try {
          const payload = JSON.parse((event as MessageEvent<string>).data) as { state: PiUiState };
          applyState(payload.state);
        } catch {
          try {
            applyState(await fetchThreadState(threadId));
          } catch (error) {
            setError(formatTransportError(error));
          }
        }
      });

      eventSource.onerror = () => {
        if (!isActive) {
          return;
        }

        setConnection("error");
      };
    };

    const bootstrap = async () => {
      setConnection("connecting");

      try {
        const state = await createThread();

        if (!isActive) {
          return;
        }

        applyState(state);
        openThreadStream(state.threadId);
      } catch (error) {
        if (!isActive) {
          return;
        }

        setConnection("error");
        setError(formatTransportError(error));
      }
    };

    void bootstrap();

    return () => {
      isActive = false;
      eventSource?.close();
      if (activeThreadId) {
        void disposeThread(activeThreadId, { keepalive: true }).catch(() => {});
      }
      setConnection("closed");
    };
  }, []);
}

function PhaseBadge({ phase }: { phase: PiUiState["phase"] | undefined }) {
  const label = phase ?? "idle";
  return <span className={`phase-badge phase-${label}`}>{label}</span>;
}

function QueueColumn(props: { items: string[]; title: string }) {
  return (
    <section className="queue-column" aria-label={props.title}>
      <header className="queue-column-header">
        <h3>{props.title}</h3>
        <span>{props.items.length}</span>
      </header>
      {props.items.length === 0 ? (
        <p className="queue-empty">Nothing queued.</p>
      ) : (
        <ul className="queue-list">
          {props.items.map((item) => (
            <li key={`${props.title}-${item}`}>{item}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LiveToolRail(props: { executions: Record<string, PiToolExecutionState> }) {
  const executions = Object.values(props.executions).slice().reverse();

  return (
    <>
      {executions.length === 0 ? (
        <p className="muted-copy">Tool calls will appear here as the harness invokes them.</p>
      ) : (
        <div className="execution-stack">
          {executions.map((execution) => (
            <details
              className={`execution-card execution-${execution.status}`}
              key={execution.toolCallId}
              open={execution.status === "running" || execution.status === "error"}
            >
              <summary className="execution-summary">
                <div>
                  <strong>{execution.toolName}</strong>
                  <p>
                    {summarizePayload(
                      execution.partialResult ?? execution.result ?? execution.args,
                    )}
                  </p>
                </div>
                <span className={`tool-status tool-status-${execution.status}`}>
                  {execution.status}
                </span>
              </summary>
              <div className="execution-body">
                <p className="execution-id">{truncateMiddle(execution.toolCallId, 10)}</p>
                <pre>
                  {formatJson(execution.partialResult ?? execution.result ?? execution.args)}
                </pre>
              </div>
            </details>
          ))}
        </div>
      )}
    </>
  );
}

function VisualizationPlaceholder(props: { title?: string }) {
  return (
    <section className="visualization-card is-pending">
      <header className="visualization-header">
        <div>
          <span className="panel-kicker">Chart</span>
          <h4>{props.title ?? "Building visualization"}</h4>
        </div>
        <span className="tool-status tool-status-running">running</span>
      </header>
      <p className="visualization-summary">
        Preparing an inline chart from the current sandbox data.
      </p>
      <div className="visualization-canvas visualization-placeholder" />
    </section>
  );
}

const VisualizationToolUI = makeAssistantToolUI({
  render: ({ args, argsText, isError, result, status, toolName }) => {
    if (isVisualizationArtifact(result)) {
      return <ChatVisualization artifact={result} pending={status.type === "running"} />;
    }

    if (status.type !== "running") {
      return (
        <GenericToolCallCard
          args={args}
          argsText={argsText}
          isError={isError}
          result={result}
          status={isError ? "incomplete" : status.type}
          toolName={toolName}
        />
      );
    }

    const title =
      isRecord(args) && typeof args.title === "string" && args.title.trim().length > 0
        ? args.title
        : undefined;

    return <VisualizationPlaceholder title={title} />;
  },
  toolName: "create_visualization",
});

function GenericToolCallCard(props: {
  args: unknown;
  argsText: string;
  isError?: boolean;
  result?: unknown;
  status: string;
  toolName: string;
}) {
  return (
    <details
      className={`tool-card tool-${props.status}`}
      open={getPartDefaultOpen(props.status, props.isError)}
    >
      <summary className="tool-header">
        <div>
          <span className="panel-kicker">Tool Call</span>
          <h4>{props.toolName}</h4>
          <p className="tool-preview">{summarizePayload(props.result ?? props.args)}</p>
        </div>
        <span className={`tool-status tool-status-${props.status}`}>{props.status}</span>
      </summary>
      <div className="tool-grid">
        <div>
          <span className="panel-kicker">Arguments</span>
          <pre>{props.argsText || formatJson(props.args)}</pre>
        </div>
        <div>
          <span className="panel-kicker">{props.isError ? "Error" : "Result"}</span>
          <pre>
            {props.result !== undefined ? formatJson(props.result) : "Awaiting tool result..."}
          </pre>
        </div>
      </div>
    </details>
  );
}

function ThreadMessageCard() {
  const createdAt = useAuiState((store) => store.message.createdAt);
  const role = useAuiState((store) => store.message.role);
  const status = useAuiState((store) => store.message.status);
  const statusLabel = status?.type ?? "complete";

  return (
    <MessagePrimitive.Root className={`message-card role-${role}`}>
      <header className="message-header">
        <div>
          <span className="message-role">{role === "assistant" ? "Niven" : "You"}</span>
          <time dateTime={createdAt.toISOString()}>
            {createdAt.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </time>
        </div>
        {role === "assistant" ? (
          <span className={`message-status message-status-${statusLabel}`}>{statusLabel}</span>
        ) : null}
      </header>
      <div className="message-body">
        <MessagePrimitive.Parts>
          {({ part }) => {
            if (part.type === "text") {
              return <MarkdownBlock text={part.text} />;
            }

            if (part.type === "reasoning") {
              return (
                <details className="reasoning-card" open={part.status.type === "running"}>
                  <summary>
                    <span>Reasoning</span>
                    <span className="reasoning-preview">{summarizePayload(part.text)}</span>
                  </summary>
                  <MarkdownBlock text={part.text} />
                </details>
              );
            }

            if (part.type === "tool-call") {
              if (part.toolUI) {
                return <div className="tool-inline">{part.toolUI}</div>;
              }

              return (
                <GenericToolCallCard
                  args={part.args}
                  argsText={part.argsText}
                  isError={part.isError}
                  result={part.result}
                  status={part.status.type}
                  toolName={part.toolName}
                />
              );
            }

            return null;
          }}
        </MessagePrimitive.Parts>
      </div>
    </MessagePrimitive.Root>
  );
}

function ChatComposer() {
  const threadId = useChatStore((store) => store.state?.threadId);
  const isRunning = useChatStore((store) => store.state?.isRunning ?? false);

  return (
    <ComposerPrimitive.Root className="composer">
      <label className="composer-label" htmlFor="wealth-composer">
        {isRunning ? "Steer the active run" : "Send a message"}
      </label>
      <div className="composer-shell">
        <ComposerPrimitive.Input
          aria-describedby="composer-hint"
          className="composer-input"
          disabled={!threadId}
          id="wealth-composer"
          placeholder={
            isRunning
              ? "Add steering while the harness is running..."
              : "Ask Niven about balances, transfers, holdings, or trades..."
          }
          submitMode="enter"
        />
        <div className="composer-actions">
          <AuiIf condition={({ thread }) => thread.isRunning}>
            <ComposerPrimitive.Cancel className="ghost-button">Cancel</ComposerPrimitive.Cancel>
          </AuiIf>
          <ComposerPrimitive.Send className="primary-button" disabled={!threadId}>
            {isRunning ? "Steer run" : "Send"}
          </ComposerPrimitive.Send>
        </div>
      </div>
      <p className="composer-hint" id="composer-hint">
        Use <code>APPROVE:</code> at the start of a message when you want to execute a live
        mutation.
      </p>
    </ComposerPrimitive.Root>
  );
}

function AppShell() {
  const connection = useChatStore((store) => store.connection);
  const error = useChatStore((store) => store.error);
  const state = useChatStore((store) => store.state);
  const transcript = state?.messages ?? EMPTY_MESSAGES;
  const executionCount = Object.keys(state?.toolExecutions ?? EMPTY_EXECUTIONS).length;

  return (
    <div className="wealth-shell">
      <aside className="status-rail">
        <div className="brand-panel">
          <p className="panel-kicker">Wealth Harness</p>
          <h1>Niven</h1>
          <p className="lead-copy">
            Minimal local chat surface for the harness, with reasoning and tool activity available
            when you need it.
          </p>
        </div>

        <section className="rail-panel">
          <div className="panel-heading">
            <span className="panel-kicker">Run State</span>
            <h2>Thread telemetry</h2>
          </div>
          <dl className="status-grid">
            <div>
              <dt>Connection</dt>
              <dd className={`connection-pill connection-${connection}`}>{connection}</dd>
            </div>
            <div>
              <dt>Phase</dt>
              <dd>
                <PhaseBadge phase={state?.phase} />
              </dd>
            </div>
            <div>
              <dt>Thread</dt>
              <dd className="mono-copy">
                {state?.threadId ? truncateMiddle(state.threadId, 4) : "..."}
              </dd>
            </div>
            <div>
              <dt>Session</dt>
              <dd className="mono-copy">
                {state?.sessionId ? truncateMiddle(state.sessionId, 4) : "..."}
              </dd>
            </div>
          </dl>

          {state?.retry ? (
            <div className="alert-card">
              <strong>Retrying</strong>
              <p>
                Attempt {state.retry.attempt} of {state.retry.maxAttempts} after{" "}
                {state.retry.delayMs}ms.
              </p>
              <p>{state.retry.errorMessage}</p>
            </div>
          ) : null}

          {state?.compaction?.active ? (
            <div className="alert-card">
              <strong>Compacting</strong>
              <p>Context compaction is active because of {state.compaction.reason}.</p>
            </div>
          ) : null}

          {error || state?.lastError ? (
            <div className="alert-card alert-error">
              <strong>Latest error</strong>
              <p>{error ?? state?.lastError}</p>
            </div>
          ) : null}
        </section>

        <section className="rail-panel">
          <div className="panel-heading">
            <span className="panel-kicker">Queue</span>
            <h2>Pending instructions</h2>
          </div>
          <div className="queue-grid">
            <QueueColumn items={state?.queue.steering ?? []} title="Steering" />
            <QueueColumn items={state?.queue.followUp ?? []} title="Follow-up" />
          </div>
        </section>

        <section className="rail-panel">
          <div className="panel-heading">
            <span className="panel-kicker">Tools</span>
            <h2>
              {executionCount === 0
                ? "No activity"
                : `${executionCount} recorded call${executionCount === 1 ? "" : "s"}`}
            </h2>
          </div>
          <LiveToolRail executions={state?.toolExecutions ?? EMPTY_EXECUTIONS} />
        </section>
      </aside>

      <ThreadPrimitive.Root asChild>
        <main className="transcript-panel">
          <header className="transcript-header">
            <div>
              <p className="panel-kicker">Current Harness Chat</p>
              <h2>Live transcript</h2>
            </div>
            <PhaseBadge phase={state?.phase} />
          </header>

          <ThreadPrimitive.Viewport aria-live="polite" className="transcript-list">
            <ThreadPrimitive.Empty>
              <div className="empty-state">
                <h3>Spinning up the harness thread</h3>
                <p>
                  If no durable memory exists yet, Niven will begin onboarding automatically before
                  normal wealth assistance.
                </p>
              </div>
            </ThreadPrimitive.Empty>

            {transcript.length > 0 ? (
              <ThreadPrimitive.Messages
                components={{
                  AssistantMessage: ThreadMessageCard,
                  UserMessage: ThreadMessageCard,
                }}
              />
            ) : null}
          </ThreadPrimitive.Viewport>

          <ChatComposer />
        </main>
      </ThreadPrimitive.Root>
    </div>
  );
}

export default function App() {
  useThreadBootstrap();
  const runtime = useWealthAssistantRuntime();

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <VisualizationToolUI />
      <AppShell />
    </AssistantRuntimeProvider>
  );
}
