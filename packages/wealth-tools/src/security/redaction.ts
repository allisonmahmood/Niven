import { isRecord } from "@niven/shared";

const SENSITIVE_KEY_PATTERN =
  /(^|_)(access_token|client_id|password|public_token|refresh_token|secret|token)$/i;

export function redactSensitiveData(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitiveData(entry));
  }

  if (!isRecord(value)) {
    return value;
  }

  const redacted: Record<string, unknown> = {};

  for (const [key, nestedValue] of Object.entries(value)) {
    redacted[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? "[REDACTED]"
      : redactSensitiveData(nestedValue);
  }

  return redacted;
}
