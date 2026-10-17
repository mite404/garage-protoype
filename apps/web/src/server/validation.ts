import "server-only";
import { z } from "zod";
import { AppError } from "./errors";

/** Validates untrusted operation input without leaking schema or source contents.
 * @throws {AppError} For malformed input.
 */
export function parseInput<T>(schema: z.ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new AppError(422, "INVALID_INPUT", "Evidence input is invalid.");
  return parsed.data;
}
