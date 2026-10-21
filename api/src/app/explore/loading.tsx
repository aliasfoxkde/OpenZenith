/**
 * Next.js App Router loading boundary for the `/explore` segment. It is
 * streamed in while the explorer page's server work is pending, rendering a
 * centred spinner on a dark backdrop instead of the full map UI.
 */
export default function Loading() {
  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0a0a0a",
        color: "#666",
        fontFamily: "system-ui, sans-serif",
        fontSize: 14,
        gap: 12,
      }}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style={{ animation: "spin 1s linear infinite" }}>
        <circle cx="12" cy="12" r="10" stroke="#333" strokeWidth="2" />
        <path d="M12 2a10 10 0 0 1 10 10" stroke="#666" strokeWidth="2" strokeLinecap="round" />
      </svg>
      Loading explorer...
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}
