import type { ComponentProps, ReactNode } from "react";

// Garage's public wordmark path, as served on shopgarage.com.
const wordmarkPath =
  "M47.197 187q-19 0-29.498-7.5-10.5-7.5-14.5-20.75-4-13.5-2.999-31.25 1.25-17.75 5.5-38.25Q14.949 45.75 31.198 23q16.5-23 44.997-23 29.497 0 39.747 17.25 10.5 17.25 5.5 51.5H79.945q2.25-15.5 1-22.5t-7.75-7q-7.5 0-12.75 13Q55.448 65 49.698 92.5q-3 14.75-5 27.5-2 12.5-.75 20.25 1.5 7.75 8.5 7.75 5.25 0 8.999-5.25 3.999-5.25 6.75-18.25l1-5.75h-12l7-33.5 54.246.25-8.999 42q-4.25 21.25-13.5 34.5-9.249 13-21.748 19t-26.998 6M102.554 184.75 168.05 2.5h61.996l-9.5 182.25h-43.247l2.75-30h-24.748l-9.499 30zm63.746-65h16.749l4.75-40.75 3.749-35h-1.749l-10.75 34.5zM229.854 184.75 267.852 2.5h49.497q26.498 0 37.497 12 11 11.75 10.499 31-.75 19-9.249 33.75T333.847 99l-.25 1.75q10.25 3.75 12 12.75t-1.5 23.75l-6 29.25a100 100 0 0 0-1.5 10.5q-.5 5.25-.75 7.75H291.1q-.249-3.5 0-7.5a45 45 0 0 1 1.25-8.25l5.75-27q1.5-7.5 1.25-13.25-.25-6-6.25-6h-5.999l-12.75 62zm64.746-97h5q8 0 13.249-9 5.5-9 5.999-23.75.25-7.5-2.999-10.25-3.25-3-9-3h-2.75zM343.993 184.75 409.489 2.5h61.996l-9.5 182.25h-43.247l2.75-30H396.74l-9.5 30zm63.746-65h16.749L429.237 79l3.75-35h-1.75l-10.749 34.5zM523.483 187q-18.998 0-29.498-7.5-10.498-7.5-14.499-20.75-3.999-13.5-3-31.25 1.25-17.75 5.5-38.25 9.25-43.5 25.498-66.25 16.498-23 44.997-23 29.498 0 39.747 17.25 10.5 17.25 5.5 51.5h-41.497q2.25-15.5 1-22.5t-7.75-7q-7.499 0-12.749 13-5 12.75-10.749 40.25-3 14.75-5 27.5-2 12.5-.75 20.25 1.5 7.75 8.5 7.75 5.25 0 8.999-5.25 4-5.25 6.75-18.25l1-5.75h-12l7-33.5 54.246.25-8.999 42q-4.25 21.25-13.499 34.5-9.25 13-21.749 19-12.5 6-26.998 6M587.008 184.75 625.006 2.5H707l-7.749 39.25h-38.998l-6.499 31.75h34.997l-7.749 36.5h-34.748l-7.499 35.5h38.497l-7.999 39.25z";
const testimonial = {
  quote:
    "The funds that we received from selling the fire truck go right back into our department.",
  name: "Assistant Fire Chief Christopher Brown",
  organization: "Colchester Fire Department, Vermont",
};
const accessFailure = "This account does not have active application access.";
const credentialFailure = "Sign-in failed. Check your credentials and try again.";

function Wordmark() {
  return (
    <p className="sign-in-wordmark">
      <svg viewBox="0 0 707 187" aria-hidden="true">
        <path fill="currentColor" d={wordmarkPath} />
      </svg>
      <span className="sr-only">Garage</span>
    </p>
  );
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      className="sign-in-field-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function MailIcon() {
  return (
    <Icon>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </Icon>
  );
}

function LockIcon() {
  return (
    <Icon>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </Icon>
  );
}

function Field({
  label,
  icon,
  ...input
}: { label: string; icon: ReactNode } & ComponentProps<"input"> & { id: string }) {
  return (
    <div className="sign-in-field">
      <label htmlFor={input.id}>{label}</label>
      <div className="sign-in-control">
        {icon}
        <input className="sign-in-input" {...input} />
      </div>
    </div>
  );
}

function PhotoPanel({ photoUrl }: { photoUrl: string }) {
  return (
    <aside className="sign-in-photo" aria-label="Customer story">
      <img src={photoUrl} alt="" />
      <div className="sign-in-brand">
        <Wordmark />
        <p className="sign-in-independent">Independent prototype · Not affiliated with Garage</p>
      </div>
      <figure className="sign-in-testimonial">
        <svg className="sign-in-quote-mark" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z" />
        </svg>
        <blockquote>{testimonial.quote}</blockquote>
        <figcaption>
          {testimonial.name}
          <br />
          {testimonial.organization}
        </figcaption>
      </figure>
      <div className="sign-in-dots" aria-hidden="true">
        <span />
        <span />
        <span data-active="true" />
        <span />
      </div>
    </aside>
  );
}

/** Frames identity pages with the same photo and prototype disclosure. */
export function AccountLayout({ children, photoUrl }: { children: ReactNode; photoUrl: string }) {
  return (
    <div className="sign-in-screen" data-theme="light">
      <a className="dispatch-skip" href="#main-content">
        Skip to content
      </a>
      <PhotoPanel photoUrl={photoUrl} />
      <main id="main-content" className="sign-in-column" tabIndex={-1}>
        <div className="sign-in-block">{children}</div>
      </main>
    </div>
  );
}

/** Posts invited credentials to the existing sign-in endpoint without a demo bypass. */
export function SignInScreen({ configured, error }: { configured: boolean; error?: string }) {
  return (
    <>
      <header className="sign-in-heading">
        <h1>Sign in to Signal Desk</h1>
        <p>Use the individual account provided by your prototype operator.</p>
      </header>
      {!configured && (
        <output className="sign-in-notice">
          Sign-in is not configured yet. No live authentication or processing is available.
        </output>
      )}
      {error && (
        <p role="alert" className="sign-in-notice sign-in-error">
          {error === "access" ? accessFailure : credentialFailure}
        </p>
      )}
      <form action="/auth/sign-in" method="post" className="sign-in-form">
        <Field
          id="email"
          label="Email"
          icon={<MailIcon />}
          name="email"
          type="email"
          autoComplete="username"
          placeholder="you@example.com"
          required
          maxLength={254}
          disabled={!configured}
        />
        <Field
          id="password"
          label="Password"
          icon={<LockIcon />}
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="Password"
          required
          maxLength={256}
          disabled={!configured}
        />
        <button type="submit" className="sign-in-submit" disabled={!configured}>
          Sign in
        </button>
      </form>
      <p className="sign-in-help">
        Need an account? <a href="/sign-up">View invitation details</a>.
        <br />
        An account alone does not grant spending permission.
      </p>
    </>
  );
}
