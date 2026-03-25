"use client";

import { useState, type ReactNode, type ReactElement } from "react";

interface CodeBlockProps {
  children: ReactNode;
  label?: string;
  dark?: boolean;
  code?: string;
}

export function CodeBlock({ children, label, dark = true, code }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const copyCode = () => {
    const textToCopy = code || getTextContent(children);
    navigator.clipboard.writeText(textToCopy).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div
      style={{
        position: "relative",
        background: dark ? "#0d1117" : "#f5f5f5",
        borderRadius: 8,
        padding: "0.8rem 1rem",
        fontFamily: "monospace",
        fontSize: "0.8rem",
        lineHeight: 1.7,
        overflowX: "auto",
      }}
    >
      {label && (
        <div
          style={{
            fontSize: "0.75rem",
            fontWeight: 600,
            color: dark ? "#888" : "#666",
            marginBottom: "0.4rem",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {label}
        </div>
      )}
      <button
        onClick={copyCode}
        style={{
          position: "absolute",
          top: "0.5rem",
          right: "0.5rem",
          background: "rgba(255,255,255,0.08)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 4,
          color: dark ? "#888" : "#666",
          padding: "0.2rem 0.5rem",
          cursor: "pointer",
          fontSize: "0.7rem",
          fontFamily: "inherit",
          opacity: 0.7,
          transition: "opacity 0.15s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
        onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.7")}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      {children}
    </div>
  );
}

function getTextContent(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(getTextContent).join("\n");
  return "";
}
