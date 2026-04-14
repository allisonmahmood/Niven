export type EnvMap = NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>>;

export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

export type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue | undefined;
}

export interface LinkedRecord {
  readonly id: string;
  readonly createdAt: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
