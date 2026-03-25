export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <path d="M16 2L28 28H4L16 2Z" fill="#22c55e" opacity="0.9" />
      <path d="M16 2L22 15H10L16 2Z" fill="#22c55e" opacity="0.5" />
      <path d="M4 28L16 18L28 28H4Z" fill="#22c55e" opacity="0.3" />
    </svg>
  );
}
