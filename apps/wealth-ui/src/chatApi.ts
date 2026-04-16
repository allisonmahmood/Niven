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

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: {
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
    ...init,
  });

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

export function formatTransportError(error: unknown): string {
  return getErrorMessage(error);
}
