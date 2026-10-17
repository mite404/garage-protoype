import { startStreamingOwner } from "./server/streaming-owner";

const owner = await startStreamingOwner();
process.stdout.write("Specialist streaming owner ready. External sending is disabled.\n");
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await owner.stop();
  process.exit(0);
}
process.once("SIGINT", () => {
  void stop();
});
process.once("SIGTERM", () => {
  void stop();
});
