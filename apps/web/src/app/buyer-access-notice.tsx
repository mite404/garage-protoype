import Link from "next/link";

/** Gives both buyer entry points the same invited-access explanation without private record details. */
export function BuyerAccessNotice({ message }: { message: string }) {
  return (
    <section>
      <h1>Invited buyer access</h1>
      <p className="my-5">{message}</p>
      <Link className="button" href="/sign-in">
        Sign in with an invited buyer account
      </Link>
    </section>
  );
}
