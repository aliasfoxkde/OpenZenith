import Link from "next/link";

export default function NotFound() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg, #0a0a0a)",
        color: "var(--fg, #e5e5e5)",
        fontFamily: "var(--font-inter, system-ui, sans-serif)",
        padding: "2rem",
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontSize: "8rem",
          fontWeight: 800,
          lineHeight: 1,
          background: "linear-gradient(135deg, #0ea5e9, #22c55e)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          marginBottom: "1rem",
        }}
      >
        404
      </div>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: "0 0 0.5rem" }}>Page Not Found</h1>
      <p style={{ color: "#888", maxWidth: 400, margin: "0 0 2rem" }}>
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
      </p>
      <Link
        href="/"
        style={{
          display: "inline-block",
          padding: "0.75rem 1.5rem",
          borderRadius: 8,
          background: "#0ea5e9",
          color: "#fff",
          textDecoration: "none",
          fontWeight: 500,
          fontSize: "0.95rem",
        }}
      >
        Back to Home
      </Link>
    </div>
  );
}
