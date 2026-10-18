import assert from "node:assert/strict";
import { test } from "node:test";
import { runWorker } from "../worker";
import { startStreamingOwner } from "./streaming-owner";

test("long-lived processes refuse Supabase's transaction pooler before connecting", async () => {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL =
    "postgres://runtime:secret@aws-1-us-west-2.pooler.supabase.com:6543/postgres";
  try {
    await assert.rejects(
      startStreamingOwner(),
      /streaming owner cannot use the Supabase transaction pooler \(port 6543\)/,
    );
    await assert.rejects(runWorker(new AbortController().signal), /import worker cannot use/);
  } finally {
    process.env.DATABASE_URL = previous;
  }
});
