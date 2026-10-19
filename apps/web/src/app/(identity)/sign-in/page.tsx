import { authConfigured } from "@/server/auth";
import { SignInScreen } from "@signal-desk/catalog/account-screen";

/** Shows truthful configuration and sign-in failures without a demo bypass. */
export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return <SignInScreen configured={authConfigured()} error={error} />;
}
