import { getCloudflareContext } from "@flue/runtime/cloudflare";
import type { ConversationStreamStore } from "@flue/runtime/adapter";
import { SqliteConversationStreamStore } from "@flue/runtime/internal";

/** Opens Flue's canonical conversation stream in one agent object's SQLite storage. Flue keeps
 * this class internal; the Node owner reads the same records from PostgreSQL instead.
 */
export function conversationStore(storage: DurableObjectStorage): ConversationStreamStore {
  return new SqliteConversationStreamStore(storage.sql, (closure) =>
    storage.transactionSync(closure),
  );
}

/** Resolves the calling agent object's store per read, since each conversation has its own. */
export const currentConversationStore: ConversationStreamStore = {
  read: (...args) =>
    conversationStore(getCloudflareContext().storage as DurableObjectStorage).read(...args),
} as ConversationStreamStore;
