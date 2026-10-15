import "server-only";

/** A sanitized failure safe to return to an API caller. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Returns the shared JSON envelope without leaking credentials or private errors. */
export function failure(error: unknown) {
  const safe =
    error instanceof AppError
      ? error
      : new AppError(503, "UNAVAILABLE", "Service temporarily unavailable.");
  return Response.json(
    { error: { code: safe.code, message: safe.message, retryable: safe.status === 503 } },
    {
      status: safe.status,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

/** Serializes a permitted projection, never a raw private database row. */
export function success(data: unknown) {
  return Response.json({ data }, { headers: { "Cache-Control": "no-store" } });
}
