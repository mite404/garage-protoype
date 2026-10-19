import { cancelStream, readStreams, submitStream } from "@/server/streaming";
import { streamRoute } from "@/server/stream-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Observation never cancels execution; admission is idempotent per Idempotency-Key.
export const { GET, POST } = streamRoute({
  read: readStreams,
  submit: submitStream,
  cancel: cancelStream,
});
