import type { PiUiState } from "@niven/wealth-chat-bridge/pi-ui";
import { create } from "zustand";

type ConnectionState = "closed" | "connecting" | "error" | "open";

interface ChatStore {
  connection: ConnectionState;
  error: string | null;
  state: PiUiState | null;
  setConnection(connection: ConnectionState): void;
  setError(error: string | null): void;
  setState(state: PiUiState): void;
}

export const useChatStore = create<ChatStore>((set) => ({
  connection: "closed",
  error: null,
  setConnection(connection) {
    set({ connection });
  },
  setError(error) {
    set({ error });
  },
  setState(state) {
    set({ state });
  },
  state: null,
}));
