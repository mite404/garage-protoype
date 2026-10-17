import { z } from "zod";

// Application-token permissions restrict the owner's current record and spending access.
const tokenScope = z.enum(["read", "write", "spend"]);
/** Only secret-free metadata may be listed or passed to a server-rendered page. */
export const tokenView = z.object({
  id: z.uuid(),
  label: z.string(),
  scopes: z.array(tokenScope),
  expiresAt: z.string(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
});
/** Issuance defaults to read-only and requires a bounded explicit expiration. */
export const tokenCommand = z
  .object({
    label: z.string().trim().min(1).max(100),
    scopes: z
      .array(tokenScope)
      .min(1)
      .max(3)
      .default(["read"])
      .refine((s) => s.includes("read") && new Set(s).size === s.length),
    expiresAt: z.iso
      .datetime()
      .refine((s) => Date.parse(s) > Date.now() && Date.parse(s) <= Date.now() + 30 * 86400000),
  })
  .strict();
