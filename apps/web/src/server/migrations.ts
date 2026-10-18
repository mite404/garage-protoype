import type { MigrationMeta } from "drizzle-orm/migrator";

// File names the pre-Drizzle Kit runner recorded in public.signal_desk_migrations, in the same
// order as the first entries of db/migrations/meta/_journal.json.
const legacyNames = [
  "001-foundation.sql",
  "002-inference.sql",
  "003-evidence.sql",
  "004-photos.sql",
  "005-assistance.sql",
  "006-app-tokens.sql",
  "007-streaming.sql",
  "008-session-access.sql",
  "009-municipality-workspace.sql",
  "010-stream-activity.sql",
];

/** Drizzle migration records for the journal entries the legacy runner already applied, so a
 * database migrated before Drizzle Kit continues from where it stopped instead of reapplying.
 * The legacy runner applied files in order, so only the leading applied run counts.
 */
export function legacyBaseline(migrations: MigrationMeta[], applied: string[]) {
  const done = new Set(applied);
  const prefix = legacyNames.findIndex((name) => !done.has(name));
  const count = prefix === -1 ? legacyNames.length : prefix;
  return migrations
    .slice(0, count)
    .map(({ hash, folderMillis }) => ({ hash, createdAt: folderMillis }));
}
