import assert from "node:assert/strict";
import { test } from "node:test";

const origin = process.env.TEST_APP_URL;
if (process.env.CI && !origin) throw new Error("CI requires TEST_APP_URL.");

test(
  "anonymous HTTP callers cannot read private records or initiate processing",
  { skip: !origin },
  async () => {
    const paths: [string, string][] = [
      ["/api/v1/desk/opportunities/any", "GET"],
      ["/api/v1/buyer/opportunities/any", "GET"],
      ["/api/v1/desk/sources/any/content", "GET"],
      ["/api/v1/desk/vehicles/any/sources", "POST"],
      ["/api/v1/desk/vehicles/any/imports", "POST"],
      ["/api/v1/desk/jobs/any/retry", "POST"],
      ["/api/v1/buyer/vehicles/any/inquiries", "POST"],
    ];
    for (const [path, method] of paths) {
      const response = await fetch(new URL(path, origin), { method });
      assert.equal(response.status, 401, `${method} ${path}`);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.deepEqual(await response.json(), {
        error: {
          code: "UNAUTHENTICATED",
          message: "Sign in with an invited account.",
          retryable: false,
        },
      });
    }
    const registration = await fetch(new URL("/auth/sign-up", origin), { method: "POST" });
    assert.equal(registration.status, 403);
    const crossSite = await fetch(new URL("/auth/sign-out", origin), {
      method: "POST",
      headers: { Origin: "https://evil.example" },
    });
    assert.equal(crossSite.status, 403);
  },
);
