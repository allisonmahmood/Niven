import { spawn } from "node:child_process";

import { clearExplicitApprovalOverride, setExplicitApprovalOverride } from "./approval.js";

export const OPENAI_CODEX_PROVIDER = "openai-codex";

export interface OutputStream {
  write(chunk: string): void;
}

export interface InputStream extends AsyncIterable<string> {
  isTTY?: boolean;
  setEncoding?(encoding: BufferEncoding): void;
}

export interface PromptInterface {
  question(prompt: string): Promise<string>;
  close(): void;
}

export interface OAuthAuthInfo {
  url: string;
  instructions?: string;
}

export interface OAuthPromptLike {
  message: string;
  placeholder?: string;
}

export interface OAuthCredentialLike {
  access: string;
  refresh: string;
  expires: number;
  [key: string]: unknown;
}

export interface AuthCredentialLike {
  type: string;
}

export interface HarnessAuthStorage {
  get(provider: string): AuthCredentialLike | undefined;
  set(provider: string, credential: { type: "oauth" } & OAuthCredentialLike): void;
}

export interface BrowserProcessLike {
  on(event: "error", handler: () => void): void;
  unref(): void;
}

export type BrowserSpawn = (
  command: string,
  args: string[],
  options: { detached: true; stdio: "ignore" },
) => BrowserProcessLike;

export interface HarnessSessionEvent {
  type: string;
  assistantMessageEvent?: {
    type: string;
    delta?: string;
  };
}

export interface HarnessSession {
  subscribe(listener: (event: HarnessSessionEvent) => void): () => void;
  prompt(text: string): Promise<void>;
  messages: unknown[];
  dispose(): void;
}

export interface CreateSessionOptions {
  cwd: string;
  authStorage: HarnessAuthStorage;
  sessionManager: unknown;
  tools: [];
}

export interface PromptAwareSessionManager {
  appendMessage(message: { content: string; role: "user"; timestamp: number }): void;
}

export interface HarnessDeps {
  agentDir: string;
  authPath: string;
  repoRoot: string;
  sessionCwd: string;
  stdin: InputStream;
  stdout: OutputStream;
  stderr: OutputStream;
  mkdir(dir: string): void;
  createPrompter(): PromptInterface;
  openBrowser(url: string): boolean;
  login(options: {
    onAuth: (info: OAuthAuthInfo) => void;
    onPrompt: (prompt: OAuthPromptLike) => Promise<string>;
    onProgress?: (message: string) => void;
    onManualCodeInput?: () => Promise<string>;
  }): Promise<OAuthCredentialLike>;
  authStorage: HarnessAuthStorage;
  createSession(options: CreateSessionOptions): Promise<{ session: HarnessSession }>;
  createInMemorySessionManager(cwd: string): unknown;
}

export interface AssistantTextMessageLike {
  role: "assistant";
  content: Array<
    | {
        type: "text";
        text: string;
      }
    | {
        type: string;
        [key: string]: unknown;
      }
  >;
}

function hasAppendMessage(value: unknown): value is PromptAwareSessionManager {
  return (
    typeof value === "object" &&
    value !== null &&
    "appendMessage" in value &&
    typeof value.appendMessage === "function"
  );
}

function startsWithApproval(prompt: string): boolean {
  return prompt.trim().toUpperCase().startsWith("APPROVE:");
}

export function writeLine(stream: OutputStream, message: string): void {
  stream.write(`${message}\n`);
}

export function printUsage(stderr: OutputStream): void {
  writeLine(stderr, "Usage:");
  writeLine(stderr, "  pnpm harness:login");
  writeLine(stderr, "  pnpm harness:chat");
  writeLine(stderr, '  pnpm harness:prompt -- "your prompt"');
  writeLine(stderr, '  printf "your prompt" | pnpm harness:prompt');
}

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function openBrowser(
  url: string,
  options: {
    platform?: NodeJS.Platform;
    spawnCommand?: BrowserSpawn;
  } = {},
): boolean {
  const platform = options.platform ?? process.platform;
  const spawnCommand =
    options.spawnCommand ?? ((command, args, spawnOptions) => spawn(command, args, spawnOptions));

  const opener =
    platform === "darwin"
      ? { command: "open", args: [url] }
      : platform === "win32"
        ? { command: "cmd", args: ["/c", "start", "", url] }
        : { command: "xdg-open", args: [url] };

  try {
    const child = spawnCommand(opener.command, opener.args, {
      detached: true,
      stdio: "ignore",
    });

    child.on("error", () => {
      // Ignore late opener failures. The printed URL is the reliable fallback.
    });

    child.unref();
    return true;
  } catch {
    return false;
  }
}

export function getCommand(argv: readonly string[]): string | undefined {
  return argv[2];
}

export function getCommandArgs(argv: readonly string[]): readonly string[] {
  const args = argv.slice(3);
  return args[0] === "--" ? args.slice(1) : args;
}

export async function readPromptFromInput(
  args: readonly string[],
  stdin: InputStream,
): Promise<string | undefined> {
  const prompt = args.join(" ").trim();

  if (prompt) {
    return prompt;
  }

  if (stdin.isTTY) {
    return undefined;
  }

  let buffer = "";
  stdin.setEncoding?.("utf8");

  for await (const chunk of stdin) {
    buffer += chunk;
  }

  const trimmed = buffer.trim();
  return trimmed || undefined;
}

export function isAssistantMessage(message: unknown): message is AssistantTextMessageLike {
  return (
    typeof message === "object" &&
    message !== null &&
    "role" in message &&
    message.role === "assistant" &&
    "content" in message &&
    Array.isArray(message.content)
  );
}

export function getAssistantText(message: AssistantTextMessageLike): string {
  return message.content
    .filter(
      (
        content,
      ): content is Extract<AssistantTextMessageLike["content"][number], { type: "text" }> => {
        return content.type === "text";
      },
    )
    .map((content) => content.text)
    .join("");
}

export function createHarnessCli(deps: HarnessDeps) {
  function requireOAuthCredential(): boolean {
    const credential = deps.authStorage.get(OPENAI_CODEX_PROVIDER);

    if (credential?.type === "oauth") {
      return true;
    }

    writeLine(deps.stderr, "OpenAI Codex OAuth is not set up yet.");
    writeLine(deps.stderr, "Run `pnpm harness:login` first.");
    writeLine(deps.stderr, `Credentials are stored at ${deps.authPath}.`);
    return false;
  }

  async function createPromptSession(): Promise<{
    readonly session: HarnessSession;
    readonly sessionManager: unknown;
  }> {
    const sessionManager = deps.createInMemorySessionManager(deps.sessionCwd);
    const { session } = await deps.createSession({
      cwd: deps.sessionCwd,
      authStorage: deps.authStorage,
      sessionManager,
      tools: [],
    });

    return {
      session,
      sessionManager,
    };
  }

  async function runSessionPrompt(
    session: HarnessSession,
    prompt: string,
    sessionManager?: unknown,
  ): Promise<void> {
    let streamedOutput = "";
    let wroteStream = false;

    const unsubscribe = session.subscribe((event) => {
      if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
        wroteStream = true;
        streamedOutput += event.assistantMessageEvent.delta ?? "";
        deps.stdout.write(event.assistantMessageEvent.delta ?? "");
      }
    });

    try {
      if (startsWithApproval(prompt)) {
        setExplicitApprovalOverride(prompt);

        if (hasAppendMessage(sessionManager)) {
          sessionManager.appendMessage({
            content: prompt,
            role: "user",
            timestamp: Date.now(),
          });
        }
      }

      await session.prompt(prompt);

      if (!wroteStream) {
        const lastAssistantMessage = [...session.messages].reverse().find(isAssistantMessage);
        const text = lastAssistantMessage ? getAssistantText(lastAssistantMessage) : "";

        if (text) {
          deps.stdout.write(text);
          streamedOutput = text;
        }
      }
    } finally {
      clearExplicitApprovalOverride();
      unsubscribe();
    }

    if (streamedOutput && !streamedOutput.endsWith("\n")) {
      deps.stdout.write("\n");
    }
  }

  function isExitCommand(value: string): boolean {
    const normalized = value.trim().toLowerCase();
    return normalized === "exit" || normalized === "quit" || normalized === "/exit";
  }

  async function runLogin(): Promise<number> {
    deps.mkdir(deps.agentDir);

    const prompter = deps.createPrompter();

    try {
      const credentials = await deps.login({
        onAuth: (info) => {
          const opened = deps.openBrowser(info.url);

          writeLine(deps.stderr, `Open this URL to authenticate with OpenAI Codex:\n${info.url}`);
          writeLine(
            deps.stderr,
            opened
              ? "Opened your default browser automatically."
              : "Could not open a browser automatically.",
          );

          if (info.instructions) {
            writeLine(deps.stderr, info.instructions);
          }
        },
        onPrompt: async (prompt) => {
          const suffix = prompt.placeholder ? ` (${prompt.placeholder})` : "";
          return prompter.question(`${prompt.message}${suffix} `);
        },
        onProgress: (message) => {
          writeLine(deps.stderr, `[oauth] ${message}`);
        },
        onManualCodeInput: async () => {
          return prompter.question("Enter authorization code: ");
        },
      });

      deps.authStorage.set(OPENAI_CODEX_PROVIDER, {
        type: "oauth",
        ...credentials,
      });

      writeLine(deps.stdout, `Saved OpenAI Codex OAuth credentials to ${deps.authPath}`);
      return 0;
    } finally {
      prompter.close();
    }
  }

  async function runPrompt(args: readonly string[]): Promise<number> {
    const prompt = await readPromptFromInput(args, deps.stdin);

    if (!prompt) {
      printUsage(deps.stderr);
      return 1;
    }

    if (!requireOAuthCredential()) {
      return 1;
    }

    try {
      const { session, sessionManager } = await createPromptSession();

      try {
        await runSessionPrompt(session, prompt, sessionManager);
      } finally {
        session.dispose();
      }

      return 0;
    } catch (error) {
      writeLine(deps.stderr, `Prompt failed: ${formatError(error)}`);
      writeLine(
        deps.stderr,
        "If your OpenAI Codex OAuth session expired, rerun `pnpm harness:login`.",
      );
      return 1;
    }
  }

  async function runChat(): Promise<number> {
    if (!requireOAuthCredential()) {
      return 1;
    }

    const prompter = deps.createPrompter();

    try {
      const { session, sessionManager } = await createPromptSession();
      writeLine(deps.stderr, "Interactive wealth chat started. Type `/exit` to quit.");

      try {
        while (true) {
          let prompt: string;

          try {
            prompt = (await prompter.question("wealth> ")).trim();
          } catch {
            break;
          }

          if (!prompt) {
            continue;
          }

          if (isExitCommand(prompt)) {
            break;
          }

          await runSessionPrompt(session, prompt, sessionManager);
        }
      } finally {
        session.dispose();
      }

      return 0;
    } catch (error) {
      writeLine(deps.stderr, `Chat failed: ${formatError(error)}`);
      writeLine(
        deps.stderr,
        "If your OpenAI Codex OAuth session expired, rerun `pnpm harness:login`.",
      );
      return 1;
    } finally {
      prompter.close();
    }
  }

  async function main(argv: readonly string[]): Promise<number> {
    const command = getCommand(argv);
    const args = getCommandArgs(argv);

    try {
      switch (command) {
        case "login":
          return runLogin();
        case "chat":
          return runChat();
        case "prompt":
          return runPrompt(args);
        default:
          printUsage(deps.stderr);
          return 1;
      }
    } catch (error) {
      writeLine(deps.stderr, `Command failed: ${formatError(error)}`);
      return 1;
    }
  }

  return {
    runChat,
    main,
    runLogin,
    runPrompt,
  };
}
