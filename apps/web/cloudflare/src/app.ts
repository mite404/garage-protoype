import { Hono } from "hono";
import { env } from "cloudflare:workers";
import { instrument, setProvider } from "@flue/runtime";
import { admittedProvider } from "../../src/server/streaming-provider";
import { salesInterceptor } from "../../src/server/streaming-turn";
import { currentConversationStore } from "./conversation-store";
import { cancelTurn, kickTurn } from "./cloudflare";
import { enqueueImport } from "./imports";
import { transport } from "./transport";
import "./database";

setProvider(admittedProvider(currentConversationStore, transport));
instrument({ observe: () => {}, dispose: () => {}, interceptor: salesInterceptor });

const encoder = new TextEncoder();

// Fails closed without a configured token and compares in constant time.
function authorized(header: string | undefined, token: string | undefined) {
  if (!token || !header) return false;
  const given = encoder.encode(header);
  const expected = encoder.encode(`Bearer ${token}`);
  return given.byteLength === expected.byteLength && crypto.subtle.timingSafeEqual(given, expected);
}

const app = new Hono();

// Internal adapter for a Node web app; the web Worker uses the StreamOwner service binding
// instead. It never reads or returns conversation or source content.
app.use("/internal/*", async (c, next) => {
  if (!authorized(c.req.header("authorization"), env.STREAM_WORKER_TOKEN))
    return c.json({ error: "unauthorized" }, 401);
  await next();
});
app.post("/internal/turns/:id", async (c) => {
  await kickTurn(c.req.param("id"));
  return c.json({ kicked: true }, 202);
});
app.post("/internal/turns/:id/cancel", async (c) =>
  c.json({ acknowledged: await cancelTurn(c.req.param("id")) }, 202),
);
app.post("/internal/imports/:id", async (c) => {
  await enqueueImport(c.req.param("id"));
  return c.json({ queued: true }, 202);
});

export default app;
