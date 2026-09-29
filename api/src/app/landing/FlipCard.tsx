"use client";

import { useCallback, useState } from "react";

/**
 * 3D flip card. Hover (on pointer devices), focus, or activate to flip:
 * the front summarizes, the back details + calls to action. Structure and
 * motion live in globals.css (.oz-flip-*); theme colors come from the
 * [data-theme] CSS variables, so no color props are needed.
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
      role="button"
      tabIndex={0}
      aria-pressed={flipped}
      aria-label={label ? `${label} — activate to flip for details` : "Activate to flip for details"}
      onClick={(e) => {
        // CTAs on the back face navigate; don't also flip the card.
        if ((e.target as HTMLElement).closest("a, button")) return;
        toggle();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggle();
        } else if (e.key === "Escape") {
          unflip();
        }
      }}
    >
      <div className="oz-flip-inner">
        <div className="oz-flip-face oz-flip-front">
          {front}
          <svg className="oz-flip-hint" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
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
        </div>
        <div className="oz-flip-face oz-flip-back">{back}</div>
      </div>
    </div>
  );
}
