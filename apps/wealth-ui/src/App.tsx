import { AssistantRuntimeProvider } from "@assistant-ui/react";
import type {
  PiToolExecutionState,
  PiUiState,
  ThreadMessage,
  ThreadToolCallPart,
} from "@niven/wealth-chat-bridge/pi-ui";
import { type FormEvent, type KeyboardEvent, startTransition, useEffect, useState } from "react";

import { useWealthAssistantRuntime } from "./assistantRuntime";
import {
  cancelThread,
  createThread,
  fetchThreadState,
  formatTransportError,
  sendThreadMessage,
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

function getMessagePreview(message: ThreadMessage): string {
  return message.content
    .flatMap((part) => {
      if (part.type === "text" || part.type === "reasoning") {
        return [part.text];
      }

      if (part.type === "tool-call") {
        return [`Used ${part.toolName}`];
      }

      return [];
    })
    .join("\n")
    .trim();
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

function getPartDefaultOpen(
  status: ThreadToolCallPart["status"],
  isError: boolean | undefined,
): boolean {
  return status === "running" || status === "requires-action" || Boolean(isError);
}

function useThreadBootstrap(): void {
  useEffect(() => {
    let isActive = true;
    let eventSource: EventSource | null = null;

    const applyState = (nextState: PiUiState) => {
      const { setError, setState } = useChatStore.getState();

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
      eventSource = new EventSource(`/api/v1/chat/threads/${threadId}/events`);

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

function ToolCallCard({ part }: { part: ThreadToolCallPart }) {
  return (
    <details
      className={`tool-card tool-${part.status}`}
      open={getPartDefaultOpen(part.status, part.isError)}
    >
      <summary className="tool-header">
        <div>
          <span className="panel-kicker">Tool Call</span>
          <h4>{part.toolName}</h4>
          <p className="tool-preview">{summarizePayload(part.result ?? part.args)}</p>
        </div>
        <span className={`tool-status tool-status-${part.status}`}>{part.status}</span>
      </summary>
      <div className="tool-grid">
        <div>
          <span className="panel-kicker">Arguments</span>
          <pre>{part.argsText || formatJson(part.args)}</pre>
        </div>
        <div>
          <span className="panel-kicker">{part.isError ? "Error" : "Result"}</span>
          <pre>
            {part.result !== undefined ? formatJson(part.result) : "Awaiting tool result..."}
          </pre>
        </div>
      </div>
    </details>
  );
}

function TranscriptMessage({ message }: { message: ThreadMessage }) {
  const preview = getMessagePreview(message);

  return (
    <article className={`message-card role-${message.role}`}>
      <header className="message-header">
        <div>
          <span className="message-role">{message.role === "assistant" ? "Niven" : "You"}</span>
          <time dateTime={message.createdAt}>
            {new Date(message.createdAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </time>
        </div>
        {message.role === "assistant" ? (
          <span className={`message-status message-status-${message.status}`}>
            {message.status}
          </span>
        ) : null}
      </header>
      <div className="message-body">
        {message.content.length === 0 ? (
          <p className="muted-copy">{preview || "No content."}</p>
        ) : null}
        {message.content.map((part, index) => {
          const key = `${message.id}-${part.type}-${index}`;

          if (part.type === "text") {
            return <MarkdownBlock key={key} text={part.text} />;
          }

          if (part.type === "reasoning") {
            return (
              <details
                className="reasoning-card"
                key={key}
                open={message.role === "assistant" && message.status === "running"}
              >
                <summary>
                  <span>Reasoning</span>
                  <span className="reasoning-preview">{summarizePayload(part.text)}</span>
                </summary>
                <MarkdownBlock text={part.text} />
              </details>
            );
          }

          return <ToolCallCard key={key} part={part} />;
        })}
      </div>
    </article>
  );
}

function Composer() {
  const threadId = useChatStore((store) => store.state?.threadId);
  const isRunning = useChatStore((store) => store.state?.isRunning ?? false);
  const setError = useChatStore((store) => store.setError);
  const setState = useChatStore((store) => store.setState);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);

  const submit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const text = draft.trim();

    if (!text || !threadId || isSending) {
      return;
    }

    setDraft("");
    setIsSending(true);

    try {
      const nextState = await sendThreadMessage(threadId, {
        text,
        ...(isRunning ? { whileRunning: "steer" as const } : {}),
      });
      startTransition(() => {
        setState(nextState);
        setError(null);
      });
    } catch (error) {
      setDraft(text);
      setError(formatTransportError(error));
    } finally {
      setIsSending(false);
    }
  };

  const handleCancel = async () => {
    if (!threadId) {
      return;
    }

    try {
      const nextState = await cancelThread(threadId);
      startTransition(() => {
        setState(nextState);
        setError(null);
      });
    } catch (error) {
      setError(formatTransportError(error));
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape" && isRunning && threadId) {
      event.preventDefault();
      void handleCancel();
      return;
    }

    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    void submit();
  };

  return (
    <form className="composer" onSubmit={(event) => void submit(event)}>
      <label className="composer-label" htmlFor="wealth-composer">
        {isRunning ? "Steer the active run" : "Send a message"}
      </label>
      <div className="composer-shell">
        <textarea
          aria-describedby="composer-hint"
          className="composer-input"
          disabled={!threadId || isSending}
          id="wealth-composer"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            isRunning
              ? "Add steering while the harness is running..."
              : "Ask Niven about balances, transfers, holdings, or trades..."
          }
          rows={3}
          value={draft}
        />
        <div className="composer-actions">
          <button
            className="ghost-button"
            disabled={!isRunning || !threadId}
            onClick={() => void handleCancel()}
            type="button"
          >
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={!threadId || !draft.trim() || isSending}
            type="submit"
          >
            {isRunning ? "Steer run" : "Send"}
          </button>
        </div>
      </div>
      <p className="composer-hint" id="composer-hint">
        Use <code>APPROVE:</code> at the start of a message when you want to execute a live
        mutation.
      </p>
    </form>
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

      <main className="transcript-panel">
        <header className="transcript-header">
          <div>
            <p className="panel-kicker">Current Harness Chat</p>
            <h2>Live transcript</h2>
          </div>
          <PhaseBadge phase={state?.phase} />
        </header>

        <section className="transcript-list" aria-live="polite">
          {transcript.length === 0 ? (
            <div className="empty-state">
              <h3>Spinning up the harness thread</h3>
              <p>
                If no durable memory exists yet, Niven will begin onboarding automatically before
                normal wealth assistance.
              </p>
            </div>
          ) : (
            transcript.map((message) => <TranscriptMessage key={message.id} message={message} />)
          )}
        </section>

        <Composer />
      </main>
    </div>
  );
}

export default function App() {
  useThreadBootstrap();
  const runtime = useWealthAssistantRuntime();

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AppShell />
    </AssistantRuntimeProvider>
  );
}
