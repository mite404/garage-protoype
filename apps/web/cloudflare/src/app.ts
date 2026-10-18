import { Hono } from "hono";
import { env } from "cloudflare:workers";
import { instrument, setProvider } from "@flue/runtime";
import { admittedProvider } from "../../src/server/streaming-provider";
import { salesInterceptor } from "../../src/server/streaming-turn";
import { currentConversationStore } from "./conversation-store";
import { cancelTurn, kickTurn } from "./cloudflare";
import { transport } from "./transport";
import "./database";

setProvider(admittedProvider(currentConversationStore, transport));
instrument({ observe: () => {}, dispose: () => {}, interceptor: salesInterceptor });

const app = new Hono();

// Internal adapter for the web app. It never reads or returns conversation content.
app.use("/internal/*", async (c, next) => {
  if (c.req.header("authorization") !== `Bearer ${env.STREAM_WORKER_TOKEN}`)
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

export default app;
