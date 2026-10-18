/** Selects the database and owner runtime once per server instance. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (globalThis.navigator?.userAgent !== "Cloudflare-Workers") return;
  const { useCloudflareRuntime } = await import("./server/cloudflare-runtime");
  useCloudflareRuntime();
}
