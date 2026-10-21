/**
 * OpenZenith brand mark rendered as inline SVG.
 *
 * Three stacked green triangles form a stylised mountain/zenith glyph. The
 * `size` prop sets both the width and height in pixels and defaults to 28;
 * the viewBox is fixed at 32x32, so the mark scales proportionally at any size.
 */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <path d="M16 2L28 28H4L16 2Z" fill="#22c55e" opacity="0.9" />
      <path d="M16 2L22 15H10L16 2Z" fill="#22c55e" opacity="0.5" />
      <path d="M4 28L16 18L28 28H4Z" fill="#22c55e" opacity="0.3" />
    </svg>
  );
}
