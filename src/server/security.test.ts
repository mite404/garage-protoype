import assert from "node:assert/strict";
import { test } from "node:test";
import { requireSameOrigin } from "./auth";
import { AppError, failure } from "./errors";
import { resolveActor } from "./access";

test("malformed identity is denied before any database connection", async () => {
  await assert.rejects(resolveActor({ userId: "user-selected", sessionId: "fake" }), {
    status: 401,
    code: "UNAUTHENTICATED",
  });
});

test("cross-site mutations are denied and internal errors are sanitized", async () => {
  const previous = process.env.APP_ORIGIN;
  process.env.APP_ORIGIN = "https://signal.example";
  try {
    requireSameOrigin(
      new Request("https://signal.example/auth/sign-out", {
        method: "POST",
        headers: { Origin: "https://signal.example" },
      }),
    );
    assert.throws(
      () =>
        requireSameOrigin(
          new Request("https://signal.example/auth/sign-out", {
            method: "POST",
            headers: { Origin: "https://evil.example" },
          }),
        ),
      { status: 403 },
    );
    assert.throws(
      () =>
        requireSameOrigin(new Request("https://signal.example/auth/sign-out", { method: "POST" })),
      { status: 403 },
    );
    const response = failure(new Error("provider-secret and PRIVATE NOTE"));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await response.json(), {
      error: { code: "UNAVAILABLE", message: "Service temporarily unavailable.", retryable: true },
    });
    assert.equal(failure(new AppError(404, "NOT_FOUND", "Record not found.")).status, 404);
  } finally {
    if (previous === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = previous;
  }
});
