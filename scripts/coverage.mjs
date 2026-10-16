const decodeFileUrl = (url) => (url.startsWith("file:") ? decodeURI(url) : url);

/** Aligns V8 file-map URLs with literal script paths without changing ranges or hit counts. */
export function normalizeSourceMaps(dump) {
  if (!dump["source-map-cache"]) return;
  dump["source-map-cache"] = Object.fromEntries(
    Object.entries(dump["source-map-cache"]).map(([url, entry]) => {
      if (entry.data?.sources) entry.data.sources = entry.data.sources.map(decodeFileUrl);
      return [decodeFileUrl(url), entry];
    }),
  );
}
