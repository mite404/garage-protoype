import type { ReactNode } from "react";
import photo from "@signal-desk/catalog/assets/apparatus-cab.webp";
import { AccountLayout } from "@signal-desk/catalog/account-screen";

/** Keeps sign-in, invitation, and account information in one shared visual layout. */
export default function IdentityLayout({ children }: { children: ReactNode }) {
  return <AccountLayout photoUrl={photo.src}>{children}</AccountLayout>;
}
