import Link from "next/link";

/** Explains operator-provisioned access without enabling public registration. */
export default function SignUp() {
  return (
    <>
      <header className="sign-in-heading">
        <h1>Join Signal Desk</h1>
        <p>This independent prototype is available by invitation.</p>
      </header>
      <p className="sign-in-notice">
        Public registration is disabled. Contact your prototype operator to create your individual
        account and assign application access.
      </p>
      <p className="sign-in-help">
        Your operator will provide your sign-in details. Account creation does not enable model
        spending or give access to every opportunity.
      </p>
      <Link href="/sign-in" className="sign-in-submit sign-in-action">
        Already invited? Sign in
      </Link>
      <p className="sign-in-help">
        <Link href="/">Back to overview</Link>
      </p>
    </>
  );
}
