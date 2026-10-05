"use client";

import { useCallback, useState } from "react";

/**
 * 3D flip card. Hover (on pointer devices) or activate to flip: the front
 * summarizes, the back details + calls to action. Structure and motion live
 * in globals.css (.oz-flip-*); theme colors come from the [data-theme] CSS
 * variables, so no color props are needed.
 *
 * Accessibility shape (disclosure pattern): the card itself is not an
 * interactive element — the corner toggle button is the one keyboard stop
 * and the `aria-expanded` announcer. The back face (with its CTA links) is
 * visibility-gated on hover/flipped state, so a closed card is exactly one
 * tab stop and never nests interactive controls inside a role="button"
 * (axe nested-interactive) or soaks up Tabs into hidden links (2.1.1 trap).
 * Escape anywhere inside the card closes it.
 */
export function FlipCard({
  front,
  back,
  height = 160,
  label,
}: {
  front: React.ReactNode;
  back: React.ReactNode;
  /** Fixed height for the card (px). All cards should use the same value for alignment. */
  height?: number;
  /** Accessible name describing the card (usually the front title). */
  label?: string;
}) {
  const [flipped, setFlipped] = useState(false);
  const toggle = useCallback(() => {
    setFlipped((f) => !f);
  }, []);
  const unflip = useCallback(() => {
    setFlipped(false);
  }, []);

  return (
    <div
      className={`oz-flip-card${flipped ? " flipped" : ""}`}
      style={{ height }}
      onClick={(e) => {
        // CTAs on the back face and the toggle button navigate/flip on their
        // own; don't also flip the card for them.
        if ((e.target as HTMLElement).closest("a, button")) return;
        toggle();
      }}
      onKeyDown={(e) => {
        // Bubbled from the toggle button or a back-face CTA.
        if (e.key === "Escape") unflip();
      }}
    >
      {/* The toggle precedes the faces in DOM: disclosure order — activate,
          then Tab forward into the revealed content. Position is absolute
          (corner overlay), so rendering is unaffected. */}
      <button
        type="button"
        className="oz-flip-hint"
        aria-expanded={flipped}
        aria-label={label ? `${label} — flip for details` : "Flip card for details"}
        onClick={toggle}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path
            d="M13.5 8a5.5 5.5 0 1 1-1.7-3.97"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <path
            d="M13.9 1.6v3h-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <div className="oz-flip-inner">
        <div className="oz-flip-face oz-flip-front">{front}</div>
        <div className="oz-flip-face oz-flip-back">{back}</div>
      </div>
    </div>
  );
}
