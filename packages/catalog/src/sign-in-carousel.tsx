"use client";
import { useEffect, useState, useSyncExternalStore } from "react";

// One customer story: a photo and the quote shown over it.
export type SignInSlide = {
  photoUrl: string;
  quote: string;
  name: string;
  organization: string;
};

const advanceMs = 5000;
const reducedMotion = "(prefers-reduced-motion: reduce)";

function subscribeMotion(onChange: () => void) {
  const query = window.matchMedia(reducedMotion);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function QuoteMark() {
  return (
    <svg className="sign-in-quote-mark" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z" />
    </svg>
  );
}

/** Rotates customer stories every five seconds. Pauses while hovered or while a dot has
 * focus, and never advances on its own under reduced motion. Choosing a dot restarts the timer.
 */
export function SignInCarousel({ slides }: { slides: SignInSlide[] }) {
  const [active, setActive] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const still = useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia(reducedMotion).matches,
    () => true,
  );
  const paused = still || hovered || focused || slides.length < 2;
  // Depends on `active`, so a chosen slide gets a full interval before the next advance.
  useEffect(() => {
    if (paused) return;
    const timer = window.setTimeout(
      () => setActive((index) => (index + 1) % slides.length),
      advanceMs,
    );
    return () => window.clearTimeout(timer);
  }, [active, paused, slides.length]);
  const story = slides[active]!;
  return (
    <section
      className="sign-in-carousel"
      aria-roledescription="carousel"
      aria-label="Customer stories"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      {slides.map((slide, index) => (
        <img
          key={slide.photoUrl}
          src={slide.photoUrl}
          alt=""
          data-active={index === active || undefined}
          fetchPriority={index === 0 ? "high" : "low"}
        />
      ))}
      <figure
        className="sign-in-testimonial"
        key={active}
        aria-roledescription="slide"
        aria-label={`Story ${active + 1} of ${slides.length}`}
      >
        <QuoteMark />
        <blockquote>{story.quote}</blockquote>
        <figcaption>
          {story.name}
          <br />
          {story.organization}
        </figcaption>
      </figure>
      <div
        className="sign-in-dots"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      >
        {slides.map((slide, index) => (
          <button
            key={slide.photoUrl}
            type="button"
            aria-label={`Go to slide ${index + 1}`}
            aria-current={index === active || undefined}
            onClick={() => setActive(index)}
          />
        ))}
      </div>
    </section>
  );
}
