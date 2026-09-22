"use client";

/**
 * Accessible collapsible section header for globe widget panels.
 *
 * The previous markup was `<div onClick>` — invisible to keyboard users and
 * unannounced to screen readers (WCAG 2.1.1 Keyboard, 4.1.2 Name/Role/Value).
 * This renders a real `<button>` with `aria-expanded`/`aria-controls` and
 * inherits the same `.wv-section-header` look; buttons reset font styles, so
 * the few inherited-from-div properties are re-declared here via `.wv-section-header-btn`.
 */
export function SectionHeader({
  id,
  title,
  open,
  onToggle,
  bodyId,
}: {
  id: string;
  title: string;
  open: boolean;
  onToggle: () => void;
  bodyId?: string;
}) {
  return (
    <button
      type="button"
      id={id}
      className={`wv-section-header wv-section-header-btn ${open ? "open" : ""}`}
      aria-expanded={open}
      aria-controls={bodyId}
      onClick={onToggle}
    >
      <span>{title}</span>
      <span className="arrow" aria-hidden="true">
        &#9654;
      </span>
    </button>
  );
}
