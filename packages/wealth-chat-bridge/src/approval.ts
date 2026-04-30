import { buildSessionContext, type ExtensionContext } from "@mariozechner/pi-coding-agent";

export const WEALTH_APPROVAL_PREFIX = "APPROVE:";
let explicitApprovalOverride: string | undefined;

function contentToText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .flatMap((part) => {
      if (
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        part.type === "text" &&
        "text" in part &&
        typeof part.text === "string"
      ) {
        return [part.text];
      }

      return [];
    })
    .join("\n");
}

export function getLatestUserMessageText(context: ExtensionContext): string | undefined {
  const leafId = context.sessionManager.getLeafId();
  const entries = context.sessionManager.getEntries();
  const sessionContext = buildSessionContext(entries, leafId);

  for (const message of [...sessionContext.messages].reverse()) {
    if (message.role === "user") {
      const text = contentToText(message.content).trim();
      return text || undefined;
    }
  }

  return undefined;
}

function getEffectiveApprovalMessage(context: ExtensionContext): string | undefined {
  return getLatestUserMessageText(context) ?? explicitApprovalOverride;
}

export function setExplicitApprovalOverride(message: string | undefined): void {
  const trimmed = message?.trim();
  explicitApprovalOverride = trimmed ? trimmed : undefined;
}

export function clearExplicitApprovalOverride(): void {
  explicitApprovalOverride = undefined;
}

export function hasExplicitApproval(context: ExtensionContext): boolean {
  const latestUserMessage = getEffectiveApprovalMessage(context);

  if (!latestUserMessage) {
    return false;
  }

  return latestUserMessage.toUpperCase().startsWith(WEALTH_APPROVAL_PREFIX);
}

export function getApprovalRationale(context: ExtensionContext): string | undefined {
  const latestUserMessage = getEffectiveApprovalMessage(context);

  if (!latestUserMessage || !hasExplicitApproval(context)) {
    return undefined;
  }

  return latestUserMessage.trim();
}
