"use client";

import { type CSSProperties } from "react";

interface Props {
  message?: string;
  error?: boolean;
  errorMessage?: string;
  dark?: boolean;
  onRetry?: () => void;
}

const container: CSSProperties = {
  position: "absolute",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 12,
  padding: "20px 32px",
  borderRadius: 8,
  zIndex: 5,
  textAlign: "center",
};

const spinner = `
@keyframes mapload-spin {
  to { transform: rotate(360deg); }
}
@keyframes mapload-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}
`;

export function MapLoading({ message, error, errorMessage, dark, onRetry }: Props) {
  const bg = error ? "rgba(180,0,0,0.9)" : dark ? "rgba(0,0,0,0.85)" : "rgba(255,255,255,0.95)";
  const color = error ? "#fff" : dark ? "#e5e5e5" : "#171717";
  const borderColor = error ? "#ef4444" : dark ? "#333" : "#e5e5e5";

  if (error) {
    return (
      <>
        <style>{spinner}</style>
        <div style={{ ...container, background: bg, border: `1px solid ${borderColor}` }}>
          <div style={{ fontSize: 24 }}>&#x26A0;</div>
          <div style={{ fontSize: 14, color, fontWeight: 500 }}>
            {errorMessage || "Failed to load map. Please refresh the page."}
          </div>
          {onRetry && (
            <button
              onClick={onRetry}
              style={{
                marginTop: 4,
                padding: "6px 16px",
                borderRadius: 4,
                border: `1px solid ${borderColor}`,
                background: "rgba(255,255,255,0.1)",
                color,
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              Retry
            </button>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      <style>{spinner}</style>
      <div style={{ ...container, background: bg, border: `1px solid ${borderColor}` }}>
        <div
          style={{
            width: 28,
            height: 28,
            border: `3px solid ${borderColor}`,
            borderTopColor: dark ? "#3b82f6" : "#2563eb",
            borderRadius: "50%",
            animation: "mapload-spin 0.8s linear infinite",
          }}
        />
        <div style={{ fontSize: 13, color, animation: "mapload-pulse 2s ease-in-out infinite" }}>
          {message || "Loading map..."}
        </div>
      </div>
    </>
  );
}
