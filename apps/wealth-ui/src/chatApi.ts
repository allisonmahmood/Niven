import type { PiUiState } from "@niven/wealth-chat-bridge/pi-ui";

interface ApiEnvelope<T> {
  readonly data?: T;
  readonly error?: {
    readonly message?: string;
  };
  readonly ok: boolean;
}

type ChatStateEnvelope = {
  readonly state: PiUiState;
};

type RuntimeGlobals = typeof globalThis & {
  __NIVEN_API_TOKEN__?: unknown;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function readApiToken(): string | undefined {
  const runtimeToken = (globalThis as RuntimeGlobals).__NIVEN_API_TOKEN__;
  if (typeof runtimeToken === "string" && runtimeToken.trim().length > 0) {
    return runtimeToken.trim();
  }

  const buildToken = import.meta.env.VITE_NIVEN_API_TOKEN;
  return typeof buildToken === "string" && buildToken.trim().length > 0
    ? buildToken.trim()
    : undefined;
}

function createRequestInit(init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set("accept", "application/json");

  if (init?.body) {
    headers.set("content-type", "application/json");
  }

  const apiToken = readApiToken();
  if (apiToken) {
    headers.set("authorization", `Bearer ${apiToken}`);
  }

  return {
    ...init,
    headers,
  };
}

function appendApiToken(path: string): string {
  const apiToken = readApiToken();
  if (!apiToken) {
    return path;
  }

  const baseUrl =
    typeof globalThis.location?.origin === "string"
      ? globalThis.location.origin
      : "http://localhost";
  const url = new URL(path, baseUrl);
  url.searchParams.set("apiToken", apiToken);
  return `${url.pathname}${url.search}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, createRequestInit(init));

  let payload: ApiEnvelope<T> | undefined;
  try {
    payload = (await response.json()) as ApiEnvelope<T>;
  } catch {
    throw new Error(`Request to ${path} did not return JSON.`);
  }

  if (!response.ok || !payload.ok || payload.data === undefined) {
    throw new Error(payload.error?.message ?? `Request to ${path} failed with ${response.status}.`);
  }

  return payload.data;
}

export async function createThread(): Promise<PiUiState> {
  const response = await request<ChatStateEnvelope>("/api/v1/chat/threads", {
    method: "POST",
  });

  return response.state;
}

export async function fetchThreadState(threadId: string): Promise<PiUiState> {
  const response = await request<ChatStateEnvelope>(`/api/v1/chat/threads/${threadId}/state`);
  return response.state;
}

export async function sendThreadMessage(
  threadId: string,
  input: {
    readonly text: string;
    readonly whileRunning?: "followUp" | "steer";
  },
): Promise<PiUiState> {
  const response = await request<ChatStateEnvelope>(`/api/v1/chat/threads/${threadId}/messages`, {
    body: JSON.stringify(input),
    method: "POST",
  });

  return response.state;
}

export async function cancelThread(threadId: string): Promise<PiUiState> {
  const response = await request<ChatStateEnvelope>(`/api/v1/chat/threads/${threadId}/cancel`, {
    method: "POST",
  });

  return response.state;
}

export async function disposeThread(
  threadId: string,
  options?: { readonly keepalive?: boolean },
): Promise<void> {
  const path = `/api/v1/chat/threads/${threadId}/dispose`;
  const response = await fetch(
    path,
    createRequestInit({
      keepalive: options?.keepalive,
      method: "POST",
    }),
  );

  if (response.status === 204) {
    return;
  }

  let payload: ApiEnvelope<Record<string, never>> | undefined;
  try {
    payload = (await response.json()) as ApiEnvelope<Record<string, never>>;
  } catch {
    if (!response.ok) {
      throw new Error(`Request to ${path} failed with ${response.status}.`);
    }

    return;
  }

  if (!response.ok || !payload.ok) {
    throw new Error(payload.error?.message ?? `Request to ${path} failed with ${response.status}.`);
  }
}

export function buildThreadEventsUrl(threadId: string): string {
  return appendApiToken(`/api/v1/chat/threads/${threadId}/events`);
}

export function formatTransportError(error: unknown): string {
  return getErrorMessage(error);
}
