export interface NivenErrorOptions extends ErrorOptions {
  readonly code?: string;
  readonly details?: unknown;
  readonly status?: number;
}

export class NivenError extends Error {
  readonly code: string;
  readonly details: unknown;
  readonly status: number;

  constructor(message: string, options: NivenErrorOptions = {}) {
    super(message, options);
    this.name = "NivenError";
    this.code = options.code ?? "NIVEN_ERROR";
    this.details = options.details;
    this.status = options.status ?? 500;
  }
}

export class ValidationError extends NivenError {
  constructor(message: string, details?: unknown) {
    super(message, {
      code: "VALIDATION_ERROR",
      details,
      status: 400,
    });
    this.name = "ValidationError";
  }
}

export class UnauthorizedError extends NivenError {
  constructor(message = "Request is not authorized.", details?: unknown) {
    super(message, {
      code: "UNAUTHORIZED",
      details,
      status: 401,
    });
    this.name = "UnauthorizedError";
  }
}

export class NotFoundError extends NivenError {
  constructor(message: string, details?: unknown) {
    super(message, {
      code: "NOT_FOUND",
      details,
      status: 404,
    });
    this.name = "NotFoundError";
  }
}

export class ConflictError extends NivenError {
  constructor(message: string, details?: unknown) {
    super(message, {
      code: "CONFLICT",
      details,
      status: 409,
    });
    this.name = "ConflictError";
  }
}

export class ApprovalRequiredError extends NivenError {
  constructor(message = "This mutation requires explicit approval.", details?: unknown) {
    super(message, {
      code: "APPROVAL_REQUIRED",
      details,
      status: 409,
    });
    this.name = "ApprovalRequiredError";
  }
}

export class ExternalServiceError extends NivenError {
  constructor(message: string, details?: unknown, options?: ErrorOptions) {
    super(message, {
      ...options,
      code: "EXTERNAL_SERVICE_ERROR",
      details,
      status: 502,
    });
    this.name = "ExternalServiceError";
  }
}

export class NotImplementedYetError extends NivenError {
  constructor(feature: string) {
    super(`${feature} is not implemented yet.`, {
      code: "NOT_IMPLEMENTED_YET",
      status: 501,
    });
    this.name = "NotImplementedYetError";
  }
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
