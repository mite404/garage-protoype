import { z } from "zod";

/** Posts an idempotent, unsent workflow command and reports the server's sanitized rejection.
 * @throws {Error} For network failures or a rejected command.
 */
export async function postPrototypeCommand(url: string, body: string, key: string) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body,
  });
  if (!response.ok) {
    const problem = z
      .object({ error: z.object({ message: z.string() }) })
      .parse(await response.json());
    throw new Error(problem.error.message);
  }
}
