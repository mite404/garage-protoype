import {
  cancelSourcingStream,
  readSourcingStreams,
  submitSourcingStream,
} from "@/server/streaming";
import { streamRoute } from "@/server/stream-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The specialist's own sourcing-assistant turns; observation never cancels execution.
export const { GET, POST } = streamRoute({
  read: readSourcingStreams,
  submit: submitSourcingStream,
  cancel: cancelSourcingStream,
});
