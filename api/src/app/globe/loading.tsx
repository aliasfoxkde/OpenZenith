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
      Loading globe...
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}
