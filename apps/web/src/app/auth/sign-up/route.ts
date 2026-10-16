import { AppError, failure } from "@/server/errors";

/** Explicitly rejects public registration. Provision identities through the operator command. */
export async function POST() {
  return failure(new AppError(403, "REGISTRATION_DISABLED", "Public registration is disabled."));
}
