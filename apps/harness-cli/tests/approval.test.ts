import { type ExtensionContext, SessionManager } from "@mariozechner/pi-coding-agent";
import { describe, expect, it } from "vitest";

import {
  clearExplicitApprovalOverride,
  getApprovalRationale,
  getLatestUserMessageText,
  hasExplicitApproval,
  setExplicitApprovalOverride,
  WEALTH_APPROVAL_PREFIX,
} from "../src/approval.js";

function createContextWithMessages(messages: string[]): ExtensionContext {
  const sessionManager = SessionManager.inMemory("/tmp/pi-wealth-test");

  for (const message of messages) {
    sessionManager.appendMessage({
      content: message,
      role: "user",
      timestamp: Date.now(),
    });
  }

  return {
    abort() {},
    compact() {},
    cwd: "/tmp/pi-wealth-test",
    getContextUsage() {
      return undefined;
    },
    getSystemPrompt() {
      return "";
    },
    hasPendingMessages() {
      return false;
    },
    hasUI: false,
    isIdle() {
      return true;
    },
    model: undefined,
    modelRegistry: {} as ExtensionContext["modelRegistry"],
    sessionManager,
    shutdown() {},
    signal: undefined,
    ui: {} as ExtensionContext["ui"],
  };
}

describe("approval helpers", () => {
  it("returns the latest user message text", () => {
    const context = createContextWithMessages(["First", "Second"]);

    expect(getLatestUserMessageText(context)).toBe("Second");
  });

  it("detects explicit approval only when the latest message starts with the prefix", () => {
    const approvedContext = createContextWithMessages([
      "Please preview the transfer.",
      `${WEALTH_APPROVAL_PREFIX} execute the transfer preview.`,
    ]);
    const unapprovedContext = createContextWithMessages([
      `${WEALTH_APPROVAL_PREFIX} stale approval`,
      "Show me my balances.",
    ]);

    expect(hasExplicitApproval(approvedContext)).toBe(true);
    expect(getApprovalRationale(approvedContext)).toBe(
      `${WEALTH_APPROVAL_PREFIX} execute the transfer preview.`,
    );
    expect(hasExplicitApproval(unapprovedContext)).toBe(false);
    expect(getApprovalRationale(unapprovedContext)).toBeUndefined();
  });

  it("falls back to an explicit override when the current prompt is not yet in session history", () => {
    const context = createContextWithMessages([]);

    setExplicitApprovalOverride(`${WEALTH_APPROVAL_PREFIX} execute the transfer.`);

    try {
      expect(hasExplicitApproval(context)).toBe(true);
      expect(getApprovalRationale(context)).toBe(`${WEALTH_APPROVAL_PREFIX} execute the transfer.`);
    } finally {
      clearExplicitApprovalOverride();
    }
  });
});
