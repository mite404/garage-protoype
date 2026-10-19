import type { ReactNode } from "react";
import auburn from "@signal-desk/catalog/assets/garage-man-inspects-truck.webp";
import burlington from "@signal-desk/catalog/assets/garage-man-inspects-truck-2.webp";
import colchester from "@signal-desk/catalog/assets/apparatus-cab.webp";
import elbaSalem from "@signal-desk/catalog/assets/garage-back-of-truck.webp";
import { AccountLayout } from "@signal-desk/catalog/account-screen";

// Garage's public customer stories, used for this prototype mock with Ethan's approval.
// Replace or extend freely; order is display order.
const slides = [
  {
    photoUrl: auburn.src,
    quote:
      "Within a day of listing for free on Garage, we started receiving questions and within four days we sold our truck.",
    name: "Deputy Fire Chief Glenn Johnson",
    organization: "Auburn Fire Rescue Department, Massachusetts",
  },
  {
    photoUrl: burlington.src,
    quote:
      "Having an online platform like Garage changes the game. The freight pickup experience was easy.",
    name: "Fire Chief Michael LaChance",
    organization: "Burlington Fire Department, Vermont",
  },
  {
    photoUrl: colchester.src,
    quote:
      "The funds that we received from selling the fire truck go right back into our department.",
    name: "Assistant Fire Chief Christopher Brown",
    organization: "Colchester Fire Department, Vermont",
  },
  {
    photoUrl: elbaSalem.src,
    quote:
      "Within a day of listing for free on Garage, we started receiving questions and within four days we sold our truck. We took that money and put it towards equipment for our department.",
    name: "Fire Chief Britt Ewalt",
    organization: "Elba-Salem Fire Protection District, Illinois",
  },
];

/** Keeps sign-in, invitation, and account information in one shared visual layout. */
export default function IdentityLayout({ children }: { children: ReactNode }) {
  return <AccountLayout slides={slides}>{children}</AccountLayout>;
}
