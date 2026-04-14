import { describe, expect, it, vi } from "vitest";

import {
  type BrowserProcessLike,
  createHarnessCli,
  getCommandArgs,
  type HarnessSession,
  type InputStream,
  openBrowser,
  readPromptFromInput,
} from "../src/harness.js";

function createWritable() {
  let value = "";

  return {
    stream: {
      write(chunk: string) {
        value += chunk;
      },
    },
    get value() {
      return value;
    },
  };
}

function createInput(chunks: readonly string[], isTTY = false): InputStream {
  return {
    isTTY,
    setEncoding: vi.fn(),
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

function createPrompter(answers: readonly string[] = []) {
  const queue = [...answers];

  return {
    question: vi.fn(async () => {
      return queue.shift() ?? "";
    }),
    close: vi.fn(),
  };
}

function createFakeSession(
  options: {
    messages?: unknown[];
    onPrompt?: (emit: (event: unknown) => void) => Promise<void> | void;
  } = {},
): HarnessSession {
  const listeners: Array<(event: unknown) => void> = [];

  return {
    messages: options.messages ?? [],
    subscribe(listener) {
      listeners.push(listener);
      return vi.fn();
    },
    async prompt() {
      await options.onPrompt?.((event) => {
        for (const listener of listeners) {
          listener(event);
        }
      });
    },
    dispose: vi.fn(),
  };
}

function createHarnessTestApp(overrides: Partial<Parameters<typeof createHarnessCli>[0]> = {}) {
  const stdout = createWritable();
  const stderr = createWritable();
  const prompter = createPrompter();
  const authStorage = {
    get: vi.fn(),
    set: vi.fn(),
  };
  const createSession = vi.fn();
  const createInMemorySessionManager = vi.fn(() => ({ kind: "memory-session-manager" }));

  const app = createHarnessCli({
    agentDir: "/tmp/pi-agent",
    authPath: "/tmp/pi-agent/auth.json",
    repoRoot: "/repo/root",
    sessionCwd: "/tmp/pi-wealth-workspace",
    stdin: createInput([], true),
    stdout: stdout.stream,
    stderr: stderr.stream,
    mkdir: vi.fn(),
    createPrompter: vi.fn(() => prompter),
    openBrowser: vi.fn(() => true),
    login: vi.fn(async () => ({
      access: "access-token",
      refresh: "refresh-token",
      expires: 123,
    })),
    authStorage,
    createSession,
    createInMemorySessionManager,
    ...overrides,
  });

  return {
    app,
    stdout,
    stderr,
    prompter,
    authStorage,
    createSession,
    createInMemorySessionManager,
  };
}

describe("openBrowser", () => {
  it("uses the macOS opener and detaches the process", () => {
    const child: BrowserProcessLike = {
      on: vi.fn(),
      unref: vi.fn(),
    };
    const spawnCommand = vi.fn(() => child);

    const opened = openBrowser("https://example.com", {
      platform: "darwin",
      spawnCommand,
    });

    expect(opened).toBe(true);
    expect(spawnCommand).toHaveBeenCalledWith("open", ["https://example.com"], {
      detached: true,
      stdio: "ignore",
    });
    expect(child.unref).toHaveBeenCalled();
  });

  it("returns false when spawning the opener throws", () => {
    const opened = openBrowser("https://example.com", {
      platform: "linux",
      spawnCommand: vi.fn(() => {
        throw new Error("spawn failed");
      }),
    });

    expect(opened).toBe(false);
  });
});

describe("readPromptFromInput", () => {
  it("prefers positional arguments over stdin", async () => {
    const prompt = await readPromptFromInput(
      ["summarize", "repo"],
      createInput(["ignored"], false),
    );

    expect(prompt).toBe("summarize repo");
  });

  it("ignores the pnpm argument separator when present", () => {
    expect(
      getCommandArgs(["node", "index.js", "prompt", "--", "APPROVE:", "move", "cash"]),
    ).toEqual(["APPROVE:", "move", "cash"]);
  });

  it("reads and trims piped stdin when no positional prompt is supplied", async () => {
    const stdin = createInput(["  summarize ", "repo  "], false);
    const prompt = await readPromptFromInput([], stdin);

    expect(prompt).toBe("summarize repo");
    expect(stdin.setEncoding).toHaveBeenCalledWith("utf8");
  });
});

describe("createHarnessCli", () => {
  it("logs in, auto-opens the browser, and stores OAuth credentials", async () => {
    const customPrompter = createPrompter(["manual-paste", "manual-code"]);
    const { app, stdout, stderr, authStorage } = createHarnessTestApp({
      createPrompter: vi.fn(() => customPrompter),
      login: vi.fn(async ({ onAuth, onProgress, onPrompt, onManualCodeInput }) => {
        onAuth({
          url: "https://auth.example.test",
          instructions: "Complete the login flow.",
        });
        onProgress?.("Waiting for OAuth callback");
        await onPrompt({ message: "Paste code", placeholder: "code" });
        await onManualCodeInput?.();

        return {
          access: "oauth-access",
          refresh: "oauth-refresh",
          expires: 456,
        };
      }),
    });

    const exitCode = await app.main(["node", "index.js", "login"]);

    expect(exitCode).toBe(0);
    expect(authStorage.set).toHaveBeenCalledWith(
      "openai-codex",
      expect.objectContaining({
        type: "oauth",
        access: "oauth-access",
        refresh: "oauth-refresh",
        expires: 456,
      }),
    );
    expect(stderr.value).toContain("https://auth.example.test");
    expect(stderr.value).toContain("Opened your default browser automatically.");
    expect(stderr.value).toContain("[oauth] Waiting for OAuth callback");
    expect(stderr.value).toContain("Complete the login flow.");
    expect(stdout.value).toContain("Saved OpenAI Codex OAuth credentials");
    expect(customPrompter.close).toHaveBeenCalled();
  });

  it("prints fallback guidance when the browser opener is unavailable", async () => {
    const { app, stderr } = createHarnessTestApp({
      openBrowser: vi.fn(() => false),
      login: vi.fn(async ({ onAuth }) => {
        onAuth({ url: "https://auth.example.test" });
        return {
          access: "oauth-access",
          refresh: "oauth-refresh",
          expires: 456,
        };
      }),
    });

    const exitCode = await app.main(["node", "index.js", "login"]);

    expect(exitCode).toBe(0);
    expect(stderr.value).toContain("Could not open a browser automatically.");
    expect(stderr.value).toContain("https://auth.example.test");
  });

  it("fails prompt runs cleanly when OAuth credentials are missing", async () => {
    const { app, stderr, authStorage } = createHarnessTestApp();
    authStorage.get.mockReturnValue(undefined);

    const exitCode = await app.main(["node", "index.js", "prompt", "Summarize this repository"]);

    expect(exitCode).toBe(1);
    expect(stderr.value).toContain("OpenAI Codex OAuth is not set up yet.");
    expect(stderr.value).toContain("Run `pnpm harness:login` first.");
    expect(stderr.value).toContain("/tmp/pi-agent/auth.json");
  });

  it("fails chat runs cleanly when OAuth credentials are missing", async () => {
    const { app, stderr, authStorage } = createHarnessTestApp();
    authStorage.get.mockReturnValue(undefined);

    const exitCode = await app.main(["node", "index.js", "chat"]);

    expect(exitCode).toBe(1);
    expect(stderr.value).toContain("OpenAI Codex OAuth is not set up yet.");
    expect(stderr.value).toContain("Run `pnpm harness:login` first.");
  });

  it("uses piped stdin as the prompt and streams text deltas", async () => {
    const session = createFakeSession({
      onPrompt: async (emit) => {
        emit({
          type: "message_update",
          assistantMessageEvent: {
            type: "text_delta",
            delta: "Hello",
          },
        });
        emit({
          type: "message_update",
          assistantMessageEvent: {
            type: "text_delta",
            delta: " world",
          },
        });
      },
    });

    const createSessionMock = vi.fn(async () => ({ session }));

    const { app, stdout, authStorage, createInMemorySessionManager } = createHarnessTestApp({
      stdin: createInput(["  Summarize this repository  "], false),
      createSession: createSessionMock,
    });

    authStorage.get.mockReturnValue({
      type: "oauth",
    });

    const exitCode = await app.main(["node", "index.js", "prompt"]);

    expect(exitCode).toBe(0);
    expect(createInMemorySessionManager).toHaveBeenCalledWith("/tmp/pi-wealth-workspace");
    expect(createSessionMock).toHaveBeenCalledWith({
      cwd: "/tmp/pi-wealth-workspace",
      authStorage,
      sessionManager: { kind: "memory-session-manager" },
      tools: [],
    });
    expect(stdout.value).toBe("Hello world\n");
  });

  it("pre-seeds explicit approval prompts into the session manager before execution", async () => {
    const session = createFakeSession({
      onPrompt: async (emit) => {
        emit({
          type: "message_update",
          assistantMessageEvent: {
            type: "text_delta",
            delta: "Executed",
          },
        });
      },
    });
    const sessionManager = {
      appendMessage: vi.fn(),
    };
    const createInMemorySessionManager = vi.fn(() => sessionManager);

    const { app, authStorage } = createHarnessTestApp({
      createInMemorySessionManager,
      createSession: vi.fn(async () => ({ session })),
    });

    authStorage.get.mockReturnValue({
      type: "oauth",
    });

    const exitCode = await app.main([
      "node",
      "index.js",
      "prompt",
      "APPROVE: move 5.00 from checking to savings",
    ]);

    expect(exitCode).toBe(0);
    expect(createInMemorySessionManager).toHaveBeenCalledWith("/tmp/pi-wealth-workspace");
    expect(sessionManager.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "APPROVE: move 5.00 from checking to savings",
        role: "user",
      }),
    );
  });

  it("falls back to the final assistant message when nothing was streamed", async () => {
    const session = createFakeSession({
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "Final answer",
            },
          ],
        },
      ],
    });

    const { app, stdout, authStorage } = createHarnessTestApp({
      createSession: vi.fn(async () => ({ session })),
    });

    authStorage.get.mockReturnValue({
      type: "oauth",
    });

    const exitCode = await app.main(["node", "index.js", "prompt", "Summarize this repository"]);

    expect(exitCode).toBe(0);
    expect(stdout.value).toBe("Final answer\n");
  });

  it("keeps a single session alive across chat turns until exit", async () => {
    const session = createFakeSession({
      onPrompt: async (emit) => {
        emit({
          type: "message_update",
          assistantMessageEvent: {
            type: "text_delta",
            delta: "Response\n",
          },
        });
      },
    });
    const createSessionMock = vi.fn(async () => ({ session }));
    const prompter = createPrompter(["first turn", "second turn", "/exit"]);
    const { app, stdout, stderr, authStorage, createInMemorySessionManager } = createHarnessTestApp(
      {
        createPrompter: vi.fn(() => prompter),
        createSession: createSessionMock,
      },
    );

    authStorage.get.mockReturnValue({
      type: "oauth",
    });

    const promptSpy = vi.spyOn(session, "prompt");
    const exitCode = await app.main(["node", "index.js", "chat"]);

    expect(exitCode).toBe(0);
    expect(createInMemorySessionManager).toHaveBeenCalledTimes(1);
    expect(createInMemorySessionManager).toHaveBeenCalledWith("/tmp/pi-wealth-workspace");
    expect(createSessionMock).toHaveBeenCalledTimes(1);
    expect(promptSpy).toHaveBeenCalledTimes(2);
    expect(promptSpy).toHaveBeenNthCalledWith(1, "first turn");
    expect(promptSpy).toHaveBeenNthCalledWith(2, "second turn");
    expect(stderr.value).toContain("Interactive wealth chat started.");
    expect(stdout.value).toContain("Response\nResponse\n");
  });

  it("surfaces prompt failures with rerun-login guidance", async () => {
    const session = createFakeSession({
      onPrompt: async () => {
        throw new Error("session blew up");
      },
    });

    const { app, stderr, authStorage } = createHarnessTestApp({
      createSession: vi.fn(async () => ({ session })),
    });

    authStorage.get.mockReturnValue({
      type: "oauth",
    });

    const exitCode = await app.main(["node", "index.js", "prompt", "Summarize this repository"]);

    expect(exitCode).toBe(1);
    expect(stderr.value).toContain("Prompt failed: session blew up");
    expect(stderr.value).toContain("rerun `pnpm harness:login`");
  });
});
