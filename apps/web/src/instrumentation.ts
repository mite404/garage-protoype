/** Selects the database runtime once per server instance. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (globalThis.navigator?.userAgent !== "Cloudflare-Workers") return;
  const { useCloudflareDatabase } = await import("./server/cloudflare-database");
  useCloudflareDatabase();
}
