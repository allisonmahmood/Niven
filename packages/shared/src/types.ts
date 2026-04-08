export type EnvMap = NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>>;

export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

export interface LinkedRecord {
  readonly id: string;
  readonly createdAt: string;
}
