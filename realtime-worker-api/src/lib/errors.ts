/** Typed worker errors.
 *
 *  Each subclass carries a default HTTP status code so a top-level
 *  dispatcher can map an unhandled `WorkerError` to a response without
 *  losing the original message. Existing call sites still build their
 *  responses with `jsonResponse` directly — these classes are an
 *  additive contract that future handlers can opt into. */

export type WorkerErrorCode =
  | "auth"
  | "rate_limited"
  | "validation"
  | "not_found"
  | "forbidden"
  | "method_not_allowed"
  | "upstream";

export class WorkerError extends Error {
  readonly status: number;
  readonly code: WorkerErrorCode;
  readonly context?: Record<string, unknown>;

  constructor(
    code: WorkerErrorCode,
    status: number,
    message: string,
    context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "WorkerError";
    this.status = status;
    this.code = code;
    this.context = context;
  }
}

export class AuthError extends WorkerError {
  constructor(message = "Unauthorized", context?: Record<string, unknown>) {
    super("auth", 401, message, context);
    this.name = "AuthError";
  }
}

export class ForbiddenError extends WorkerError {
  constructor(message = "Forbidden", context?: Record<string, unknown>) {
    super("forbidden", 403, message, context);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends WorkerError {
  constructor(message = "Not found", context?: Record<string, unknown>) {
    super("not_found", 404, message, context);
    this.name = "NotFoundError";
  }
}

export class MethodNotAllowedError extends WorkerError {
  constructor(
    message = "Method not allowed",
    context?: Record<string, unknown>,
  ) {
    super("method_not_allowed", 405, message, context);
    this.name = "MethodNotAllowedError";
  }
}

export class RateLimitError extends WorkerError {
  constructor(
    message = "Rate limit exceeded. Try again in a minute.",
    context?: Record<string, unknown>,
  ) {
    super("rate_limited", 429, message, context);
    this.name = "RateLimitError";
  }
}

export class ValidationError extends WorkerError {
  constructor(message: string, context?: Record<string, unknown>) {
    super("validation", 400, message, context);
    this.name = "ValidationError";
  }
}
